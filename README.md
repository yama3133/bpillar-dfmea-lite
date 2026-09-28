# bpillar-dfmea-lite

AWS ブログ「Building AI-augmented B-pillar DFMEA on AWS」(2026-09-27)の構成を軽量に再現したデモです。

> **注意**: `ontology/` の工学的内容(材料・工程・故障モード・因果関係・重大度など)はデモ用の簡略化であり、実データではありません。実際の設計判断には使用しないでください。

## ブログ構成との対応

| ブログ | 本リポジトリ |
|---|---|
| React / S3 + CloudFront (OAC) | `web/`(Vite + React + TS)、`DfmeaWeb` |
| Amazon Cognito | User Pool(セルフサインアップ無効、LITE)、SRP 認証 |
| AWS WAF | `DfmeaWaf`(CommonRuleSet + IP ごと 1000 リクエスト/5 分) |
| API Gateway REST + WebSocket | REST(Cognito オーソライザー)、WebSocket($connect で ID トークン検証) |
| Amazon Neptune | rdflib + S3 上の TTL(バージョニング有効、レビューごとに versionId を固定) |
| Amazon OpenSearch Serverless(Amazon Bedrock Knowledge Bases) | 不使用 |
| マルチエージェント | Strands Agents「Agents as Tools」: 分析(Claude Sonnet 4.6)+ 専門 2(Claude Haiku 4.5)、Lambda 上 |
| Human-in-the-loop | Step Functions `WAIT_FOR_TASK_TOKEN` 1 か所 |

## ワークフロー

```
PinOntology → Analyze → Validate → needsHitl? ─no─→ Finalize(completed)
                                     └yes→ HitlGate(taskToken, 24h) → approve → Finalize(completed)
                                                                   └ reject  → FinalizeRejected(rejected_by_reviewer)
全 Task: Catch States.ALL → NotifyFailure → Fail
```

- ステート間は `reviewId` などの ID のみ。所見は DynamoDB(`FINDING#<id>`)に保存。
- `needsHitl` = 検証を通過した所見のうち `confidence < HITL_CONFIDENCE_THRESHOLD`(cdk context `hitlThreshold`、既定 0.6)が 1 件以上。
- 検証(`backend/src/dfmea/ontology/validate.py`)は決定的:
  - `UNRESOLVED_IRI`: 各 IRI が期待クラス(rdf:type / rdfs:subClassOf*)に解決できない
  - `BROKEN_CAUSAL_PATH`: `cause_path + [failure_mode, effect]` の隣接ペアに直接 `dfm:causes` 辺がない。根本(先頭)が Process の場合に限り、最初の辺だけ `dfm:induces` を許容
  - `COMPONENT_MISMATCH`: `failure_mode dfm:occursAt component` が成り立たない
- レポートは通過所見を RPN(S×O×D)降順、却下所見は別枠。

## WebSocket イベント

`{"v":1,"reviewId","seq","ts","type","data"}`。`seq` は META アイテムのアトミックカウンター。
フロントは UUIDv4 で reviewId を生成 → WebSocket 接続 → `POST /reviews` → `GET /reviews/{id}/events?after=<seq>` で欠損補完。

## 多言語対応

- UI: 日本語(ja)/英語(en)/アラビア語(ar)/中国語簡体字(zh-CN)。上部バーで切り替え、localStorage(`dfmea.lang`)に保存。未保存時は `navigator.languages` から推定し、該当なしは ja。ar は `<html dir="rtl">`。辞書は `web/src/i18n.ts`(キー欠落は型エラー)。
- AI 出力: `POST /reviews` の `language`(ja|en|ar|zh-CN、省略時 ja、不正値は 400)を META に保存し、rationale / recommended_actions をその言語で生成。作成後に UI 言語を切り替えても再生成しません。
- オントロジー: `rdfs:label` に `@en @ja @ar @zh-Hans` を付与(API の `zh-CN` は TTL では `zh-Hans`)。`GET /ontology/components?lang=`(省略時 ja)は該当言語 → 英語 → IRI 末尾の順でフォールバック。エージェントのツールは英語ラベルを使います。

## 構成

```
ontology/   bpillar.ttl (1.0.0) / bpillar-v2.ttl (1.1.0: 検出管理 1 ノード追加、HAZDelayedFracture の detectedBy 1 辺変更)
presets/    seatbelt_anchor.json / roof_rail_joint.json
backend/    uv プロジェクト(src/dfmea)
infra/      CDK (TypeScript): DfmeaWaf → DfmeaWeb → DfmeaBackend → DfmeaSiteDeploy(すべて us-east-1)
web/        Vite + React + TS
```

## ローカル実行

```bash
cd backend
uv sync
uv run pytest                  # オフラインテスト(moto / Stubber)
uv run pytest -m live          # 実 Amazon Bedrock を呼ぶテスト
uv run python -m dfmea.cli analyze --ttl ../ontology/bpillar.ttl --preset ../presets/seatbelt_anchor.json --language en
```

`aws login` 由来のクレデンシャルを使う場合は `botocore[crt]` が必要です(dev 依存に含めています)。

## デプロイ

```bash
cd infra && npm ci
npx cdk deploy DfmeaWaf DfmeaWeb DfmeaBackend
cd ../web && npm ci && npm run build
cd ../infra && npx cdk deploy DfmeaSiteDeploy   # web/dist と config.json を配置
```

- Lambda 依存は `infra/lib/python-bundle.ts` で uv によりローカルバンドリング(aarch64 manylinux wheel)。Docker は不要です。
- HITL を必ず発生させたい場合: `npx cdk deploy DfmeaBackend -c hitlThreshold=1.01`
- ローカル開発で `npm run dev` を使う場合は、デプロイ済みの値で `web/public/config.json` を作成してください(git 管理外)。

## テストユーザー

セルフサインアップは無効です。管理者として作成します。

```bash
POOL=<DfmeaBackend.UserPoolId>
aws cognito-idp admin-create-user --region us-east-1 --user-pool-id $POOL \
  --username you@example.com --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-set-user-password --region us-east-1 --user-pool-id $POOL \
  --username you@example.com --password '<password>' --permanent
```

パスワードはリポジトリにコミットしないでください(`.local/` は git 管理外)。

## 削除

```bash
cd infra && npx cdk destroy DfmeaSiteDeploy DfmeaBackend DfmeaWeb DfmeaWaf
```

テーブル・バケット・ロググループ・User Pool はすべて `DESTROY` 設定です。
