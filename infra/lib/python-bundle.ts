import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AssetHashType, DockerImage } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';

/**
 * Lambda code asset for backend/ (Python 3.13, arm64).
 * Local bundling uses uv to fetch aarch64 manylinux wheels, so Docker is not required.
 */
export function pythonBundle(backendDir: string): lambda.Code {
  return lambda.Code.fromAsset(backendDir, {
    assetHashType: AssetHashType.SOURCE,
    exclude: ['.venv', 'tests', '**/__pycache__', '.pytest_cache', '*.egg-info', 'src/*.egg-info'],
    bundling: {
      image: DockerImage.fromRegistry('public.ecr.aws/sam/build-python3.13:latest-arm64'),
      command: [
        'bash', '-c',
        'pip install uv && uv export --frozen --no-dev --no-emit-project --no-hashes -o /tmp/r.txt && ' +
          'uv pip install --target /asset-output -r /tmp/r.txt && cp -r src/dfmea /asset-output/',
      ],
      local: {
        tryBundle(outputDir: string): boolean {
          const reqs = path.join(outputDir, '..', `reqs-${path.basename(outputDir)}.txt`);
          const run = (cmd: string) => execSync(cmd, { cwd: backendDir, stdio: ['ignore', 'inherit', 'inherit'] });
          run(`uv export --frozen --no-dev --no-emit-project --no-hashes -o "${reqs}"`);
          run(
            `uv pip install --target "${outputDir}" --python-platform aarch64-manylinux2014 ` +
              `--python-version 3.13 --only-binary=:all: -r "${reqs}"`,
          );
          fs.rmSync(reqs, { force: true });
          fs.cpSync(path.join(backendDir, 'src', 'dfmea'), path.join(outputDir, 'dfmea'), {
            recursive: true,
            filter: (src) => !src.includes('__pycache__'),
          });
          return true;
        },
      },
    },
  });
}
