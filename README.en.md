# bpillar-dfmea-lite

[🇯🇵 日本語](./README.md) | 🇺🇸 **English**

A lightweight reproduction of the architecture described in the AWS blog post "[Building AI-augmented B-pillar DFMEA on AWS: Architecture, multi-agent orchestration, and implementation](https://aws.amazon.com/blogs/industries/building-ai-augmented-b-pillar-dfmea-on-aws-architecture-multi-agent-orchestration-and-implementation/)" (September 27, 2026).

> **Note**: The engineering content in `ontology/` (materials, processes, failure modes, causal links, severities, and so on) is simplified for demo purposes and is not real data. Do not use it for actual design decisions.

## Mapping to the blog architecture

| Blog | This repository |
|---|---|
| React / S3 + CloudFront (OAC) | `web/` (Vite + React + TS), `DfmeaWeb` |
| Amazon Cognito | User pool (self sign-up disabled, Lite tier), SRP authentication |
| AWS WAF | `DfmeaWaf` (CommonRuleSet + 1,000 requests per 5 minutes per IP) |
| API Gateway REST + WebSocket | REST (Cognito authorizer), WebSocket (ID token verified on `$connect`) |
| Amazon Neptune | rdflib + a TTL file on S3 (versioning enabled; each review pins a `versionId`) |
| Amazon OpenSearch Serverless (Amazon Bedrock Knowledge Bases) | Not used |
| Multi-agent | Strands Agents "Agents as Tools": analyst (Claude Sonnet 4.6) + 2 specialists (Claude Haiku 4.5), running on Lambda |
| Human-in-the-loop | One Step Functions `WAIT_FOR_TASK_TOKEN` gate |

## Workflow

```
PinOntology → Analyze → Validate → needsHitl? ─no─→ Finalize(completed)
                                     └yes→ HitlGate(taskToken, 24h) → approve → Finalize(completed)
                                                                   └ reject  → FinalizeRejected(rejected_by_reviewer)
All tasks: Catch States.ALL → NotifyFailure → Fail
```

- Only IDs such as `reviewId` pass between states. Findings are stored in DynamoDB (`FINDING#<id>`).
- `needsHitl` is true when at least one finding that passed validation has `confidence < HITL_CONFIDENCE_THRESHOLD` (CDK context `hitlThreshold`, default 0.6).
- Validation (`backend/src/dfmea/ontology/validate.py`) is deterministic:
  - `UNRESOLVED_IRI`: an IRI does not resolve to the expected class (rdf:type / rdfs:subClassOf*)
  - `BROKEN_CAUSAL_PATH`: some adjacent pair in `cause_path + [failure_mode, effect]` has no direct `dfm:causes` edge. Only when the root (first element) is a Process is `dfm:induces` accepted for the first edge
  - `COMPONENT_MISMATCH`: `failure_mode dfm:occursAt component` does not hold
- The report lists accepted findings by RPN (S×O×D, descending) and rejected findings in a separate section.

## WebSocket events

`{"v":1,"reviewId","seq","ts","type","data"}`. `seq` is an atomic counter on the META item.
The frontend generates the reviewId as a UUIDv4 → opens the WebSocket → calls `POST /reviews` → fills any gaps with `GET /reviews/{id}/events?after=<seq>`.

## Multilingual support

- UI: Japanese (ja), English (en), Arabic (ar), and Simplified Chinese (zh-CN). Switch from the top bar; the choice is saved in localStorage (`dfmea.lang`). If nothing is saved, the language is inferred from `navigator.languages`, falling back to ja. Arabic sets `<html dir="rtl">`. Messages live in `web/src/i18n.ts` (a missing key is a type error).
- AI output: the `language` field of `POST /reviews` (ja|en|ar|zh-CN, default ja, invalid values return 400) is stored on META, and rationale / recommended_actions are generated in that language. Switching the UI language afterwards does not regenerate them.
- Ontology: `rdfs:label` carries `@en @ja @ar @zh-Hans` (the API's `zh-CN` maps to `zh-Hans` in TTL). `GET /ontology/components?lang=` (default ja) falls back from the requested language to English, then to the IRI local name. Agent tools always use the English labels.

## Layout

```
ontology/   bpillar.ttl (1.0.0) / bpillar-v2.ttl (1.1.0: adds one detection-control node and changes one detectedBy edge of HAZDelayedFracture)
presets/    seatbelt_anchor.json / roof_rail_joint.json
backend/    uv project (src/dfmea)
infra/      CDK (TypeScript): DfmeaWaf → DfmeaWeb → DfmeaBackend → DfmeaSiteDeploy (all in us-east-1)
web/        Vite + React + TS
```

## Running locally

```bash
cd backend
uv sync
uv run pytest                  # offline tests (moto / Stubber)
uv run pytest -m live          # tests that call Amazon Bedrock
uv run python -m dfmea.cli analyze --ttl ../ontology/bpillar.ttl --preset ../presets/seatbelt_anchor.json --language en
```

Credentials obtained through `aws login` require `botocore[crt]` (included in the dev dependencies).

## Deploying

```bash
cd infra && npm ci
npx cdk deploy DfmeaWaf DfmeaWeb DfmeaBackend
cd ../web && npm ci && npm run build
cd ../infra && npx cdk deploy DfmeaSiteDeploy   # uploads web/dist and config.json
```

- Stacks deploy to the account of your current AWS credentials (`CDK_DEFAULT_ACCOUNT`) in us-east-1.
- Lambda dependencies are bundled locally with uv by `infra/lib/python-bundle.ts` (aarch64 manylinux wheels). Docker is not required.
- To force the HITL gate: `npx cdk deploy DfmeaBackend -c hitlThreshold=1.01`
- For `npm run dev`, create `web/public/config.json` with the deployed values (it is git-ignored).

## Test users

Self sign-up is disabled. Create users as an administrator:

```bash
POOL=<DfmeaBackend.UserPoolId>
aws cognito-idp admin-create-user --region us-east-1 --user-pool-id $POOL \
  --username you@example.com --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-set-user-password --region us-east-1 --user-pool-id $POOL \
  --username you@example.com --password '<password>' --permanent
```

Do not commit passwords (`.local/` is git-ignored).

## Cleanup

```bash
cd infra && npx cdk destroy DfmeaSiteDeploy DfmeaBackend DfmeaWeb DfmeaWaf
```

Tables, buckets, log groups, and the user pool all use `DESTROY` removal policies.
