import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function run(command: string, args: string[], cwd: string) {
	try {
		return execFileSync(command, args, {
			cwd,
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
			stdio: 'pipe',
		});
	} catch (error) {
		if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
			const stdout = String(error.stdout);
			const stderr = String(error.stderr);
			throw new Error(
				[
					`${command} ${args.join(' ')} failed`,
					stdout && `stdout:\n${stdout}`,
					stderr && `stderr:\n${stderr}`,
				]
					.filter(Boolean)
					.join('\n\n'),
			);
		}

		throw error;
	}
}

describe('published package', () => {
	it(
		'should compile in a nodenext commonjs consumer from the packed tarball',
		{ timeout: 60_000 },
		() => {
			const tempDir = mkdtempSync(join(tmpdir(), 'retry-axios-pack-'));

			try {
				const [{ filename }] = JSON.parse(
					run(
						npmCommand,
						['pack', '--json', '--pack-destination', tempDir],
						repoRoot,
					),
				) as [{ filename: string }];
				const tarballPath = join(tempDir, filename);
				const consumerDir = join(tempDir, 'consumer');

				mkdirSync(consumerDir);
				writeFileSync(
					join(consumerDir, 'package.json'),
					JSON.stringify(
						{
							name: 'retry-axios-pack-smoke-test',
							private: true,
							type: 'commonjs',
							scripts: {
								build: 'tsc --pretty false',
							},
						},
						null,
						2,
					),
				);
				writeFileSync(
					join(consumerDir, 'tsconfig.json'),
					JSON.stringify(
						{
							compilerOptions: {
								target: 'esnext',
								module: 'nodenext',
								moduleResolution: 'nodenext',
								strict: true,
								declaration: true,
								esModuleInterop: true,
								skipLibCheck: true,
								outDir: 'lib',
							},
							include: ['index.ts'],
						},
						null,
						2,
					),
				);
				writeFileSync(
					join(consumerDir, 'index.ts'),
					[
						"import axios from 'axios';",
						"import * as rax from 'retry-axios';",
						'',
						'const client = axios.create();',
						'client.defaults.raxConfig = { retry: 3 };',
						'rax.attach(client);',
						'',
					].join('\n'),
				);

				run(
					npmCommand,
					[
						'install',
						'--silent',
						'--no-package-lock',
						'axios@1.14.0',
						'typescript@6.0.2',
						tarballPath,
					],
					consumerDir,
				);

				const installedPackage = JSON.parse(
					readFileSync(
						join(consumerDir, 'node_modules', 'retry-axios', 'package.json'),
						'utf8',
					),
				) as {
					exports: {
						'.': {
							types: { import: string; require: string };
						};
					};
				};

				assert.deepStrictEqual(installedPackage.exports['.'].types, {
					import: './build/src/index.d.ts',
					require: './build/src/index.d.cts',
				});
				assert.ok(
					existsSync(
						join(
							consumerDir,
							'node_modules',
							'retry-axios',
							'build',
							'src',
							'index.d.cts',
						),
					),
				);

				run(npmCommand, ['run', 'build'], consumerDir);
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		},
	);
});
