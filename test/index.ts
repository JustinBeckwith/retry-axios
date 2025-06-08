import assert from 'node:assert';
import process from 'node:process';
import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';
import nock from 'nock';
import pDefer from 'p-defer';
import { afterEach, describe, it, vitest } from 'vitest';
import type { RaxConfig } from '../src/index.js';
import * as rax from '../src/index.js';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
	let interceptorId: number | undefined;
	afterEach(() => {
		vitest.useRealTimers();
		nock.cleanAll();
		if (interceptorId !== undefined) {
			rax.detach(interceptorId);
		}
	});

	it('should provide an expected set of defaults', async () => {
		const scope = nock(url).get('/').thrice().reply(500);
		interceptorId = rax.attach();
		try {
			await axios(url);
		} catch (error) {
			const axiosError = error as AxiosError;
			scope.done();
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 3, 'currentRetryAttempt');
			assert.strictEqual(config.retry, 3, 'retry');
			assert.strictEqual(config.retryDelay, 100, 'retryDelay');
			assert.strictEqual(config.backoffType, 'exponential', 'backoffType');
			assert.strictEqual(config.checkRetryAfter, true);
			assert.strictEqual(config.maxRetryAfter, 60_000 * 5);
			const expectedMethods = new Set([
				'GET',
				'HEAD',
				'PUT',
				'OPTIONS',
				'DELETE',
			]);
			assert.ok(config.httpMethodsToRetry);
			for (const method of config.httpMethodsToRetry) {
				assert(expectedMethods.has(method), 'exected method: $method');
			}

			const expectedStatusCodes = [
				[100, 199],
				[429, 429],
				[500, 599],
			];
			const statusCodesToRetry = config.statusCodesToRetry;
			assert.ok(statusCodesToRetry);
			for (const [i, [min, max]] of statusCodesToRetry.entries()) {
				const [expMin, expMax] = expectedStatusCodes[i];
				assert.strictEqual(min, expMin, 'status code min');
				assert.strictEqual(max, expMax, 'status code max');
			}

			return;
		}

		assert.fail('Expected to throw.');
	});

	it('should retry on 500 on the main export', async () => {
		const scopes = [
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const result = await axios({ url });
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should support methods passed as an object', async () => {
		const scopes = [
			nock(url).post('/').reply(500),
			nock(url).post('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const result = await axios.post(
			url,
			{},
			{ raxConfig: { httpMethodsToRetry: { ...['POST'] } } },
		);
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should not retry on a post', async () => {
		const scope = nock(url).post('/').reply(500);
		interceptorId = rax.attach();
		try {
			await axios.post(url);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it(
		'should retry at least the configured number of times',
		{ timeout: 10_000 },
		async () => {
			const scopes = [
				nock(url).get('/').times(3).reply(500),
				nock(url).get('/').reply(200, 'milk'),
			];
			interceptorId = rax.attach();
			const cfg: rax.RaxConfig = { url, raxConfig: { retry: 4 } };
			const result = await axios(cfg);
			assert.strictEqual(result.data, 'milk');
			for (const s of scopes) {
				s.done();
			}
		},
	);

	it(
		'should retry at least the configured number of times for custom client',
		{ timeout: 10_000 },
		async () => {
			const scopes = [
				nock(url).get('/').times(3).reply(500),
				nock(url).get('/').reply(200, 'milk'),
			];
			const client = axios.create();
			interceptorId = rax.attach(client);
			const cfg: rax.RaxConfig = { url, raxConfig: { retry: 4 } };
			const result = await client(cfg);
			assert.strictEqual(result.data, 'milk');
			for (const s of scopes) {
				s.done();
			}
		},
	);

	it('should not retry more than configured', async () => {
		const scope = nock(url).get('/').twice().reply(500);
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = { url, raxConfig: { retry: 1 } };
		try {
			await axios(cfg);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 1);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should have non-zero delay between first and second attempt, static backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500, 'foo'];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'bar'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'static',
			},
		});

		// Confirm that first retry did yield 200 OK with expected body
		assert.strictEqual(result.data, 'bar');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// The default delay between attempts using the
		// static backoff strategy is 100 ms. Test with tolerance.
		assert.strict(
			delayInSeconds < 0.16 && delayInSeconds > 0.1,
			`unexpected delay: ${delayInSeconds.toFixed(3)} s`,
		);
	});

	it('should have non-zero delay between first and second attempt, linear backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500, 'foo'];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'bar'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'linear',
			},
		});

		// Confirm that first retry did yield 200 OK with expected body
		assert.strictEqual(result.data, 'bar');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// The default delay between the first two attempts using the
		// linear backoff strategy is 1000 ms. Test with tolerance.
		assert.strict(
			delayInSeconds < 1.1 && delayInSeconds > 1,
			`unexpected delay: ${delayInSeconds.toFixed(3)} s`,
		);
	});

	it('should have non-zero delay between first and second attempt, exp backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500, 'foo'];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'bar'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'exponential',
			},
		});

		// Confirm that first retry did yield 200 OK with expected body
		assert.strictEqual(result.data, 'bar');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// The default delay between attempts using the exp backoff strategy with
		// default retryDelay=100 is: ((2^1 - 1) / 2) * 100 = 50 ms. Test with tolerance.
		assert.strict(
			delayInSeconds < 0.1 && delayInSeconds > 0.04,
			`unexpected delay: ${delayInSeconds.toFixed(3)} s`,
		);
	});

	it('should accept a new axios instance', async () => {
		const scopes = [
			nock(url).get('/').times(2).reply(500),
			nock(url).get('/').reply(200, 'raisins'),
		];
		const ax = axios.create();
		interceptorId = rax.attach(ax);
		const result = await ax.get(url);
		assert.strictEqual(result.data, 'raisins');
		for (const s of scopes) {
			s.done();
		}

		// Now make sure it fails the first time with just `axios`
		const scope = nock(url).get('/').reply(500);
		assert.notStrictEqual(ax, axios);
		try {
			await axios({ url });
		} catch (error) {
			const axiosError = error as AxiosError;
			assert.strictEqual(undefined, rax.getConfig(axiosError));
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should accept defaults on a new instance', async () => {
		const scopes = [
			nock(url).get('/').times(2).reply(500),
			nock(url).get('/').reply(200, '🥧'),
		];
		const ax = axios.create();
		ax.defaults.raxConfig = {
			retry: 3,
			async onRetryAttempt(event) {
				const config = event.config;
				assert.ok(config);
				console.log(`attempt #${config.raxConfig?.currentRetryAttempt}`);
			},
		};
		interceptorId = rax.attach(ax);
		const result = await ax.get(url);
		assert.strictEqual(result.data, '🥧');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should not retry on 4xx errors', async () => {
		const scope = nock(url).get('/').reply(404);
		interceptorId = rax.attach();
		try {
			await axios.get(url);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should not retry if retries set to 0', async () => {
		const scope = nock(url).get('/').reply(500);
		interceptorId = rax.attach();
		try {
			const cfg: rax.RaxConfig = { url, raxConfig: { retry: 0 } };
			await axios(cfg);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(0, config.currentRetryAttempt);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should allow configuring backoffType', async () => {
		const scope = nock(url)
			.get('/')
			.replyWithError(
				Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
			);
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: { backoffType: 'exponential' },
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.backoffType, 'exponential');
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should notify on retry attempts', async () => {
		const scopes = [
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		let flipped = false;
		const config: RaxConfig = {
			url,
			raxConfig: {
				async onRetryAttempt(error) {
					const config = rax.getConfig(error);
					assert.ok(config);
					assert.strictEqual(config.currentRetryAttempt, 1);
					flipped = true;
				},
			},
		};
		await axios(config);
		assert.strictEqual(flipped, true);
		for (const s of scopes) {
			s.done();
		}
	});

	it('should notify on retry attempts as a promise', async () => {
		const scopes = [
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		let flipped = false;
		const config: RaxConfig = {
			url,
			raxConfig: {
				async onRetryAttempt(error) {
					return new Promise((resolve) => {
						const config = rax.getConfig(error);
						assert.ok(config);
						assert.strictEqual(config.currentRetryAttempt, 1);
						flipped = true;
						resolve(undefined);
					});
				},
			},
		};
		await axios(config);
		assert.strictEqual(flipped, true);
		for (const s of scopes) {
			s.done();
		}
	});

	it('should support overriding the shouldRetry method', async () => {
		const scope = nock(url).get('/').reply(500);
		interceptorId = rax.attach();
		const config: RaxConfig = {
			url,
			raxConfig: {
				shouldRetry(error) {
					rax.getConfig(error);
					return false;
				},
			},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should respect retry limit when using shouldRetry', async () => {
		// This test reproduces issue #117
		// When shouldRetry is provided along with retry count,
		// the retry count should still be respected
		const scope = nock(url).get('/').times(3).reply(500);
		interceptorId = rax.attach();
		let retryCount = 0;
		const config: RaxConfig = {
			url,
			raxConfig: {
				retry: 2, // Should only retry 2 times
				shouldRetry(_error) {
					retryCount++;
					// Always return true to retry (simulating user's condition check)
					return true;
				},
			},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			// Should have retried exactly 2 times, not more
			assert.strictEqual(config.currentRetryAttempt, 2);
			// shouldRetry should have been called 2 times:
			// once after initial failure, and once after the first retry failure
			// (not called after second retry because retry limit was reached)
			assert.strictEqual(retryCount, 2);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should retry on ENOTFOUND', async () => {
		const scopes = [
			nock(url)
				.get('/')
				.replyWithError(
					Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
				),
			nock(url).get('/').reply(200, 'oatmeal'),
		];
		interceptorId = rax.attach();
		const result = await axios.get(url);
		assert.strictEqual(result.data, 'oatmeal');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should retry on ETIMEDOUT', async () => {
		const scopes = [
			nock(url)
				.get('/')
				.replyWithError(
					Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
				),
			nock(url).get('/').reply(200, 'bacon'),
		];
		interceptorId = rax.attach();
		const result = await axios.get(url);
		assert.strictEqual(result.data, 'bacon');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should not retry network errors when retry is 0', async () => {
		const scope = nock(url)
			.get('/')
			.replyWithError(
				Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
			);
		interceptorId = rax.attach();
		const config = { url, raxConfig: { retry: 0 } };
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should reset error counter upon success', async () => {
		const scopes = [
			nock(url).get('/').times(2).reply(500),
			nock(url).get('/').reply(200, 'milk'),
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = { url, raxConfig: { retry: 2 } };
		const result = await axios(cfg);
		assert.strictEqual(result.data, 'milk');
		const result2 = await axios(cfg);
		assert.strictEqual(result2.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should ignore requests that have been canceled', async () => {
		const scopes = [
			nock(url).get('/').times(2).delay(5).reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		try {
			// eslint-disable-next-line import/no-named-as-default-member
			const source = axios.CancelToken.source();
			const cfg: rax.RaxConfig = {
				url,
				raxConfig: { retry: 2 },
				cancelToken: source.token,
			};
			const request = axios(cfg);
			setTimeout(() => {
				source.cancel();
			}, 10);
			await request;
			throw new Error('The canceled request completed.');
		} catch (error) {
			// eslint-disable-next-line import/no-named-as-default-member
			assert.strictEqual(axios.isCancel(error), true);
		}

		assert.strictEqual(scopes[1].isDone(), false);
	});

	it('should accept 0 for config.retryDelay', async () => {
		const scope = nock(url)
			.get('/')
			.replyWithError(
				Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
			);
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: { retryDelay: 0 },
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.retryDelay, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should accept 0 for config.retry', async () => {
		const scope = nock(url)
			.get('/')
			.replyWithError(
				Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' }),
			);
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: { retry: 0 },
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.retry, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	// Short timeout to trip test if delay longer than expected
	it(
		'should retry with Retry-After header in seconds',
		{ timeout: 1000 },
		async () => {
			const scopes = [
				nock(url).get('/').reply(429, undefined, {
					'Retry-After': '5',
				}),
				nock(url).get('/').reply(200, 'toast'),
			];
			interceptorId = rax.attach();
			const { promise, resolve } = pDefer();
			vitest.useFakeTimers({
				shouldAdvanceTime: true, // Otherwise interferes with nock
			});
			const axiosPromise = axios({
				url,
				raxConfig: {
					onError: resolve,
					retryDelay: 10_000, // Higher default to ensure Retry-After is used
					backoffType: 'static',
				},
			});
			await promise;
			await vitest.advanceTimersByTimeAsync(5000); // Advance clock by expected retry delay
			const result = await axiosPromise;
			assert.strictEqual(result.data, 'toast');
			for (const s of scopes) {
				s.done();
			}
		},
	);

	it(
		'should retry with Retry-After header in http datetime',
		{ timeout: 1000 },
		async () => {
			const scopes = [
				nock(url).get('/').reply(429, undefined, {
					'Retry-After': 'Thu, 01 Jan 1970 00:00:05 UTC',
				}),
				nock(url).get('/').reply(200, 'toast'),
			];
			interceptorId = rax.attach();
			const { promise, resolve } = pDefer();
			vitest.useFakeTimers({
				now: new Date('1970-01-01T00:00:00Z').getTime(), // Set the clock to the epoch
			});
			const axiosPromise = axios({
				url,
				raxConfig: {
					onError: resolve,
					backoffType: 'static',
					retryDelay: 10_000,
				},
			});
			await promise;
			await vitest.advanceTimersByTimeAsync(5000);
			const result = await axiosPromise;
			assert.strictEqual(result.data, 'toast');
			for (const s of scopes) {
				s.done();
			}
		},
	);

	it('should not retry if Retry-After greater than maxRetryAfter', async () => {
		const scopes = [
			nock(url).get('/').reply(429, undefined, { 'Retry-After': '2' }),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = { url, raxConfig: { maxRetryAfter: 1000 } };
		await assert.rejects(axios(cfg));
		assert.strictEqual(scopes[1].isDone(), false);
	});

	it('should not retry if Retry-After is invalid', async () => {
		const scopes = [
			nock(url).get('/').reply(429, undefined, { 'Retry-After': 'foo' }),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = { url, raxConfig: { maxRetryAfter: 1000 } };
		await assert.rejects(axios(cfg));
		assert.strictEqual(scopes[1].isDone(), false);
	});

	// Short timeout to trip test if delay longer than expected
	it('should use maxRetryDelay', { timeout: 1000 }, async () => {
		const scopes = [
			nock(url).get('/').reply(429, undefined),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const { promise, resolve } = pDefer();
		vitest.useFakeTimers({
			shouldAdvanceTime: true, // Otherwise interferes with nock
		});
		const axiosPromise = axios({
			url,
			raxConfig: {
				onError: resolve,
				retryDelay: 10_000, // Higher default to ensure maxRetryDelay is used
				maxRetryDelay: 5000,
				backoffType: 'exponential',
			},
		});
		await promise;
		await vitest.advanceTimersByTimeAsync(5000); // Advance clock by expected retry delay
		const result = await axiosPromise;
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should handle promise rejection in onRetryAttempt', async () => {
		const scope = nock(url)
			.get('/')
			.replyWithError(
				Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
			);
		interceptorId = rax.attach();
		const config: RaxConfig = {
			url,
			raxConfig: {
				onRetryAttempt(error) {
					return new Promise((resolve, reject) => {
						// User wants to abort retry for ENOTFOUND errors
						if ('code' in error && error.code === 'ENOTFOUND') {
							reject(new Error('Not retrying ENOTFOUND'));
						} else {
							resolve();
						}
					});
				},
			},
		};
		try {
			await axios(config);
			assert.fail('Expected to throw');
		} catch (error) {
			// Should catch the rejection from onRetryAttempt
			assert.ok(error);
			assert.strictEqual((error as Error).message, 'Not retrying ENOTFOUND');
			scope.done();
		}
	});
	it('should use retryDelay as base multiplier for exponential backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'success'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'exponential',
				retryDelay: 1000, // Use 1000ms as base instead of default 100ms
			},
		});

		assert.strictEqual(result.data, 'success');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// With retryDelay=1000, first retry delay should be:
		// ((2^1 - 1) / 2) * 1000 = 0.5 * 1000 = 500ms
		// Test with tolerance
		assert.ok(
			delayInSeconds < 0.55 && delayInSeconds > 0.45,
			`unexpected delay: ${delayInSeconds.toFixed(3)} s (expected ~0.5s)`,
		);
	});

	it('should apply full jitter to exponential backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'success'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'exponential',
				jitter: 'full',
				retryDelay: 1000,
			},
		});

		assert.strictEqual(result.data, 'success');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// With full jitter, delay should be random between 0 and base delay (0.5s)
		// So it should be less than 0.5s but greater than 0
		assert.ok(
			delayInSeconds >= 0 && delayInSeconds < 0.55,
			`unexpected delay with full jitter: ${delayInSeconds.toFixed(3)} s (expected 0-0.5s)`,
		);
	});

	it('should apply equal jitter to exponential backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'success'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'exponential',
				jitter: 'equal',
				retryDelay: 1000,
			},
		});

		assert.strictEqual(result.data, 'success');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// With equal jitter, delay should be between 0.25s (half of 0.5s) and 0.5s
		assert.ok(
			delayInSeconds >= 0.25 && delayInSeconds < 0.55,
			`unexpected delay with equal jitter: ${delayInSeconds.toFixed(3)} s (expected 0.25-0.5s)`,
		);
	});

	it('should not apply jitter to static backoff', async () => {
		const requesttimes: bigint[] = [];
		const scopes = [
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [500];
				}),
			nock(url)
				.get('/')
				.reply(() => {
					requesttimes.push(process.hrtime.bigint());
					return [200, 'success'];
				}),
		];

		interceptorId = rax.attach();
		const result = await axios({
			url,
			raxConfig: {
				backoffType: 'static',
				jitter: 'full', // Should be ignored for static backoff
				retryDelay: 500,
			},
		});

		assert.strictEqual(result.data, 'success');
		for (const s of scopes) {
			s.done();
		}

		assert.strictEqual(requesttimes.length, 2);
		const delayInSeconds = Number(requesttimes[1] - requesttimes[0]) / 10 ** 9;

		// Static backoff should use exactly retryDelay regardless of jitter setting
		assert.ok(
			delayInSeconds >= 0.45 && delayInSeconds < 0.55,
			`unexpected delay: ${delayInSeconds.toFixed(3)} s (expected ~0.5s)`,
		);
	});

	it('should respect maxRetryDelay with jitter', async () => {
		const scopes = [
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const { promise, resolve } = pDefer();
		vitest.useFakeTimers({
			shouldAdvanceTime: true,
		});
		const axiosPromise = axios({
			url,
			raxConfig: {
				onError: resolve,
				retryDelay: 10_000,
				maxRetryDelay: 2000,
				backoffType: 'exponential',
				jitter: 'full',
			},
		});
		await promise;
		// Even with full jitter, delay should not exceed maxRetryDelay
		await vitest.advanceTimersByTimeAsync(2000);
		const result = await axiosPromise;
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should collect all errors in the errors array', async () => {
		const scopes = [
			nock(url).post('/').reply(500, 'Internal Server Error'),
			nock(url).post('/').reply(503, 'Service Unavailable'),
			nock(url).post('/').reply(502, 'Bad Gateway'),
			nock(url).post('/').reply(504, 'Gateway Timeout'),
		];

		interceptorId = rax.attach();
		try {
			await axios.post(
				url,
				{ data: 'test' },
				{
					raxConfig: {
						httpMethodsToRetry: ['POST'],
						retry: 3,
						retryDelay: 1,
					},
				},
			);
			assert.fail('Expected to throw');
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);

			// Verify all scopes were called
			for (const s of scopes) {
				s.done();
			}

			// Check that errors array exists and has all 4 errors (initial + 3 retries)
			assert.ok(config?.errors, 'errors array should exist');
			assert.strictEqual(
				config.errors.length,
				4,
				'should have 4 errors (initial + 3 retries)',
			);

			// Verify the status codes are captured in order
			assert.strictEqual(config.errors[0].response?.status, 500);
			assert.strictEqual(config.errors[1].response?.status, 503);
			assert.strictEqual(config.errors[2].response?.status, 502);
			assert.strictEqual(config.errors[3].response?.status, 504);

			// Verify that the last error is the same as the thrown error
			assert.strictEqual(
				config.errors[3].response?.status,
				axiosError.response?.status,
			);
		}
	});

	it('should collect errors even when using shouldRetry', async () => {
		const scopes = [
			nock(url).get('/').reply(500, 'Error 1'),
			nock(url).get('/').reply(500, 'Error 2'),
		];

		interceptorId = rax.attach();
		try {
			await axios({
				url,
				raxConfig: {
					retry: 3,
					retryDelay: 1,
					shouldRetry: (error: AxiosError) => {
						// Custom logic: only retry once
						const config = rax.getConfig(error);
						return (config?.currentRetryAttempt || 0) < 1;
					},
				},
			});
			assert.fail('Expected to throw');
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);

			// Verify both scopes were called
			for (const s of scopes) {
				s.done();
			}

			// Should have 2 errors (initial + 1 retry due to shouldRetry limiting)
			assert.ok(config?.errors, 'errors array should exist');
			assert.strictEqual(
				config.errors.length,
				2,
				'should have 2 errors (initial + 1 retry)',
			);
		}
	});

	it('should track retriesRemaining correctly', async () => {
		const scopes = [
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(500),
			nock(url).get('/').reply(500),
		];
		interceptorId = rax.attach();
		const retriesRemainingValues: number[] = [];
		const config: RaxConfig = {
			url,
			raxConfig: {
				retry: 3,
				retryDelay: 1,
				async onRetryAttempt(error) {
					const config = rax.getConfig(error);
					assert.ok(config);
					assert.ok(
						config.retriesRemaining !== undefined,
						'retriesRemaining should be defined',
					);
					retriesRemainingValues.push(config.retriesRemaining);
				},
			},
		};
		try {
			await axios(config);
			assert.fail('Expected to throw');
		} catch (error) {
			const axiosError = error as AxiosError;
			const config = rax.getConfig(axiosError);
			assert.ok(config);
			assert.strictEqual(config.currentRetryAttempt, 3);
			assert.strictEqual(config.retriesRemaining, 0);
			// Verify retriesRemaining decreased correctly: [2, 1, 0]
			assert.deepStrictEqual(retriesRemainingValues, [2, 1, 0]);
			for (const s of scopes) {
				s.done();
			}
		}
	});
});
