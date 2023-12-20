import assert from 'node:assert';
import process from 'node:process';
import axios, {type AxiosError, type AxiosRequestConfig} from 'axios';
import nock from 'nock';
import * as sinon from 'sinon';
import {describe, it, afterEach} from 'mocha';
import * as rax from '../src/index.js';
import {type RaxConfig} from '../src/index.js';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
	let interceptorId: number | undefined;
	afterEach(() => {
		sinon.restore();
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
			assert.strictEqual(config!.currentRetryAttempt, 3, 'currentRetryAttempt');
			assert.strictEqual(config!.retry, 3, 'retry');
			assert.strictEqual(config!.noResponseRetries, 2, 'noResponseRetries');
			assert.strictEqual(config!.retryDelay, 100, 'retryDelay');
			assert.strictEqual(config!.instance, axios, 'axios');
			assert.strictEqual(config!.backoffType, 'exponential', 'backoffType');
			assert.strictEqual(config!.checkRetryAfter, true);
			assert.strictEqual(config!.maxRetryAfter, 60_000 * 5);
			const expectedMethods = new Set([
				'GET',
				'HEAD',
				'PUT',
				'OPTIONS',
				'DELETE',
			]);
			for (const method of config!.httpMethodsToRetry!) {
				assert(expectedMethods.has(method), 'exected method: $method');
			}

			const expectedStatusCodes = [
				[100, 199],
				[429, 429],
				[500, 599],
			];
			const statusCodesToRetry = config!.statusCodesToRetry!;
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
		const result = await axios({url});
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
			{raxConfig: {httpMethodsToRetry: {...['POST']}}},
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
			assert.strictEqual(config!.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should retry at least the configured number of times', async function () {
		this.timeout(10_000);
		const scopes = [
			nock(url).get('/').times(3).reply(500),
			nock(url).get('/').reply(200, 'milk'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = {url, raxConfig: {retry: 4}};
		const result = await axios(cfg);
		assert.strictEqual(result.data, 'milk');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should retry at least the configured number of times for custom client', async function () {
		this.timeout(10_000);
		const scopes = [
			nock(url).get('/').times(3).reply(500),
			nock(url).get('/').reply(200, 'milk'),
		];
		const client = axios.create();
		interceptorId = rax.attach(client);
		const cfg: rax.RaxConfig = {url, raxConfig: {retry: 4}};
		const result = await client(cfg);
		assert.strictEqual(result.data, 'milk');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should not retry more than configured', async () => {
		const scope = nock(url).get('/').twice().reply(500);
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1}};
		try {
			await axios(cfg);
		} catch (error) {
			const axiosError = error as AxiosError;
			assert.strictEqual(rax.getConfig(axiosError)!.currentRetryAttempt, 1);
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

		// The default delay between attempts using the
		// exp backoff strategy is 500 ms. Test with tolerance.
		assert.strict(
			delayInSeconds < 0.55 && delayInSeconds > 0.5,
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
		const cfg: RaxConfig = {raxConfig: {instance: ax}};
		const result = await ax.get(url, cfg);
		assert.strictEqual(result.data, 'raisins');
		for (const s of scopes) {
			s.done();
		}

		// Now make sure it fails the first time with just `axios`
		const scope = nock(url).get('/').reply(500);
		assert.notStrictEqual(ax, axios);
		try {
			await axios({url});
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
			instance: ax,
			onRetryAttempt(event) {
				console.log(`attempt #${event.config!.raxConfig?.currentRetryAttempt}`);
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
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should not retry if retries set to 0', async () => {
		const scope = nock(url).get('/').reply(500);
		interceptorId = rax.attach();
		try {
			const cfg: rax.RaxConfig = {url, raxConfig: {retry: 0}};
			await axios(cfg);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(0, cfg!.currentRetryAttempt);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should allow configuring backoffType', async () => {
		const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: {backoffType: 'exponential'},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.backoffType, 'exponential');
			scope.isDone();
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
				onRetryAttempt(error) {
					const cfg = rax.getConfig(error);
					assert.strictEqual(cfg!.currentRetryAttempt, 1);
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
						const cfg = rax.getConfig(error);
						assert.strictEqual(cfg!.currentRetryAttempt, 1);
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
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.currentRetryAttempt, 0);
			scope.done();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should retry on ENOTFOUND', async () => {
		const scopes = [
			nock(url).get('/').replyWithError({code: 'ENOTFOUND'}),
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
			nock(url).get('/').replyWithError({code: 'ETIMEDOUT'}),
			nock(url).get('/').reply(200, 'bacon'),
		];
		interceptorId = rax.attach();
		const result = await axios.get(url);
		assert.strictEqual(result.data, 'bacon');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should allow configuring noResponseRetries', async () => {
		const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
		interceptorId = rax.attach();
		const config = {url, raxConfig: {noResponseRetries: 0}};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.currentRetryAttempt, 0);
			scope.isDone();
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
		const cfg: rax.RaxConfig = {url, raxConfig: {retry: 2}};
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
				raxConfig: {retry: 2},
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
		const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: {retryDelay: 0},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.retryDelay, 0);
			scope.isDone();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should accept 0 for config.retry', async () => {
		const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: {retry: 0},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.retry, 0);
			scope.isDone();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should accept 0 for config.noResponseRetries', async () => {
		const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
		interceptorId = rax.attach();
		const config: AxiosRequestConfig = {
			url,
			raxConfig: {noResponseRetries: 0},
		};
		try {
			await axios(config);
		} catch (error) {
			const axiosError = error as AxiosError;
			const cfg = rax.getConfig(axiosError);
			assert.strictEqual(cfg!.noResponseRetries, 0);
			scope.isDone();
			return;
		}

		assert.fail('Expected to throw');
	});

	it('should retry with Retry-After header in seconds', async function () {
		this.timeout(1000); // Short timeout to trip test if delay longer than expected
		const scopes = [
			nock(url).get('/').reply(429, undefined, {
				'Retry-After': '5',
			}),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const {promise, resolve} = invertedPromise();
		const clock = sinon.useFakeTimers({
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
		clock.tick(5000); // Advance clock by expected retry delay
		const result = await axiosPromise;
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should retry with Retry-After header in http datetime', async function () {
		this.timeout(1000);
		const scopes = [
			nock(url).get('/').reply(429, undefined, {
				'Retry-After': 'Thu, 01 Jan 1970 00:00:05 UTC',
			}),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const {promise, resolve} = invertedPromise();
		const clock = sinon.useFakeTimers({
			shouldAdvanceTime: true,
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
		clock.tick(5000);
		const result = await axiosPromise;
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});

	it('should not retry if Retry-After greater than maxRetryAfter', async () => {
		const scopes = [
			nock(url).get('/').reply(429, undefined, {'Retry-After': '2'}),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = {url, raxConfig: {maxRetryAfter: 1000}};
		await assert.rejects(axios(cfg));
		assert.strictEqual(scopes[1].isDone(), false);
	});

	it('should not retry if Retry-After is invalid', async () => {
		const scopes = [
			nock(url).get('/').reply(429, undefined, {'Retry-After': 'foo'}),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const cfg: rax.RaxConfig = {url, raxConfig: {maxRetryAfter: 1000}};
		await assert.rejects(axios(cfg));
		assert.strictEqual(scopes[1].isDone(), false);
	});

	it('should use maxRetryDelay', async function () {
		this.timeout(1000); // Short timeout to trip test if delay longer than expected
		const scopes = [
			nock(url).get('/').reply(429, undefined),
			nock(url).get('/').reply(200, 'toast'),
		];
		interceptorId = rax.attach();
		const {promise, resolve} = invertedPromise();
		const clock = sinon.useFakeTimers({
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
		clock.tick(5000); // Advance clock by expected retry delay
		const result = await axiosPromise;
		assert.strictEqual(result.data, 'toast');
		for (const s of scopes) {
			s.done();
		}
	});
});

function invertedPromise() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	return {promise, resolve, reject};
}
