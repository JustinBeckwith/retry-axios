import axios, {
	type AxiosError,
	type AxiosInstance,
	type AxiosRequestConfig,
	type AxiosResponse,
	isCancel,
} from 'axios';

/**
 * Configuration for the Axios `request` method.
 */
export interface RetryConfig {
	/**
	 * The number of times to retry the request.  Defaults to 3.
	 */
	retry?: number;

	/**
	 * The number of retries already attempted.
	 */
	currentRetryAttempt?: number;

	/**
	 * The delay in milliseconds used for retry backoff. Defaults to 100.
	 * - For 'static' backoff: Fixed delay between retries
	 * - For 'exponential' backoff: Base multiplier for exponential calculation
	 * - For 'linear' backoff: Ignored (uses attempt * 1000)
	 */
	retryDelay?: number;

	/**
	 * The HTTP Methods that will be automatically retried.
	 * Defaults to ['GET','PUT','HEAD','OPTIONS','DELETE']
	 */
	httpMethodsToRetry?: string[];

	/**
	 * The HTTP response status codes that will automatically be retried.
	 * Defaults to: [[100, 199], [429, 429], [500, 599]]
	 */
	statusCodesToRetry?: number[][];

	/**
	 * Function to invoke when error occurred.
	 */
	onError?: (error: AxiosError) => void | Promise<void>;

	/**
	 * Function to invoke when a retry attempt is made.
	 * The retry will wait for the returned promise to resolve before proceeding.
	 * If the promise rejects, the retry will be aborted and the rejection will be propagated.
	 */
	onRetryAttempt?: (error: AxiosError) => Promise<void>;

	/**
	 * Function to invoke which determines if you should retry.
	 * This is called after checking the retry count limit but before other default checks.
	 * Return true to retry, false to stop retrying.
	 * If not provided, uses the default retry logic based on status codes and HTTP methods.
	 */
	shouldRetry?: (error: AxiosError) => boolean;

	/**
	 * Backoff Type; 'linear', 'static' or 'exponential'.
	 */
	backoffType?: 'linear' | 'static' | 'exponential';

	/**
	 * Jitter strategy for exponential backoff. Defaults to 'none'.
	 * - 'none': No jitter (default)
	 * - 'full': Random delay between 0 and calculated exponential backoff
	 * - 'equal': Half fixed delay, half random
	 *
	 * Jitter helps prevent the "thundering herd" problem where many clients
	 * retry at the same time. Only applies when backoffType is 'exponential'.
	 */
	jitter?: 'none' | 'full' | 'equal';

	/**
	 * Whether to check for 'Retry-After' header in response and use value as delay. Defaults to true.
	 */
	checkRetryAfter?: boolean;

	/**
	 * Max permitted Retry-After value (in ms) - rejects if greater. Defaults to 5 mins.
	 */
	maxRetryAfter?: number;

	/**
	 * Ceiling for calculated delay (in ms) - delay will not exceed this value.
	 */
	maxRetryDelay?: number;

	/**
	 * Array of all errors encountered during retry attempts.
	 * Populated automatically when retries are performed.
	 * The first element is the initial error, subsequent elements are retry errors.
	 */
	errors?: AxiosError[];
}

export type RaxConfig = {
	raxConfig: RetryConfig;
} & AxiosRequestConfig;

// If this wasn't in the list of status codes where we want to automatically retry, return.
const retryRanges = [
	// https://en.wikipedia.org/wiki/List_of_HTTP_status_codes
	// 1xx - Retry (Informational, request still processing)
	// 2xx - Do not retry (Success)
	// 3xx - Do not retry (Redirect)
	// 4xx - Do not retry (Client errors)
	// 429 - Retry ("Too Many Requests")
	// 5xx - Retry (Server errors)
	[100, 199],
	[429, 429],
	[500, 599],
];

/**
 * Attach the interceptor to the Axios instance.
 * @param instance The optional Axios instance on which to attach the
 * interceptor.
 * @returns The id of the interceptor attached to the axios instance.
 */
export function attach(instance?: AxiosInstance) {
	const inst = instance || axios;
	return inst.interceptors.response.use(
		onFulfilled,
		async (error: AxiosError) => onError(inst, error),
	);
}

/**
 * Eject the Axios interceptor that is providing retry capabilities.
 * @param interceptorId The interceptorId provided in the config.
 * @param instance The axios instance using this interceptor.
 */
export function detach(interceptorId: number, instance?: AxiosInstance) {
	const inst = instance || axios;
	inst.interceptors.response.eject(interceptorId);
}

function onFulfilled(result: AxiosResponse) {
	return result;
}

/**
 * Some versions of axios are converting arrays into objects during retries.
 * This will attempt to convert an object with the following structure into
 * an array, where the keys correspond to the indices:
 * {
 *   0: {
 *     // some property
 *   },
 *   1: {
 *     // another
 *   }
 * }
 * @param obj The object that (may) have integers that correspond to an index
 * @returns An array with the pucked values
 */
function normalizeArray<T>(object?: T[]): T[] | undefined {
	const array: T[] = [];
	if (!object) {
		return undefined;
	}

	if (Array.isArray(object)) {
		return object;
	}

	if (typeof object === 'object') {
		for (const key of Object.keys(object)) {
			const number_ = Number.parseInt(key, 10);
			if (!Number.isNaN(number_)) {
				array[number_] = object[key];
			}
		}
	}

	return array;
}

/**
 * Parse the Retry-After header.
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
 * @param header Retry-After header value
 * @returns Number of milliseconds, or undefined if invalid
 */
function parseRetryAfter(header: string): number | undefined {
	// Header value may be string containing integer seconds
	const value = Number(header);
	if (!Number.isNaN(value)) {
		return value * 1000;
	}

	// Or HTTP date time string
	const dateTime = Date.parse(header);
	if (!Number.isNaN(dateTime)) {
		return dateTime - Date.now();
	}

	return undefined;
}

async function onError(instance: AxiosInstance, error: AxiosError) {
	if (isCancel(error)) {
		throw error;
	}

	const config = getConfig(error) || {};
	config.currentRetryAttempt ||= 0;
	config.retry = typeof config.retry === 'number' ? config.retry : 3;
	config.retryDelay =
		typeof config.retryDelay === 'number' ? config.retryDelay : 100;
	config.backoffType ||= 'exponential';
	config.httpMethodsToRetry = normalizeArray(config.httpMethodsToRetry) || [
		'GET',
		'HEAD',
		'PUT',
		'OPTIONS',
		'DELETE',
	];
	config.checkRetryAfter =
		typeof config.checkRetryAfter === 'boolean' ? config.checkRetryAfter : true;
	config.maxRetryAfter =
		typeof config.maxRetryAfter === 'number'
			? config.maxRetryAfter
			: 60_000 * 5;

	config.statusCodesToRetry =
		normalizeArray(config.statusCodesToRetry) || retryRanges;

	// Put the config back into the err
	const axiosError = error as AxiosError;

	// biome-ignore lint/suspicious/noExplicitAny: Allow for wider range of errors
	(axiosError.config as any) = axiosError.config || {}; // Allow for wider range of errors
	(axiosError.config as RaxConfig).raxConfig = { ...config };

	// Initialize errors array on first error, or append to existing array
	if (!config.errors) {
		config.errors = [axiosError];
		(axiosError.config as RaxConfig).raxConfig.errors = config.errors;
	} else {
		config.errors.push(axiosError);
	}

	// Determine if we should retry the request
	// First check the retry count limit, then apply custom logic if provided
	if (config.shouldRetry) {
		// When custom shouldRetry is provided, we still need to check the retry count
		// to prevent infinite retries (see issue #117)
		config.currentRetryAttempt ||= 0;
		if (config.currentRetryAttempt >= (config.retry ?? 0)) {
			throw axiosError;
		}
		// Now apply the custom shouldRetry logic
		if (!config.shouldRetry(axiosError)) {
			throw axiosError;
		}
	} else {
		// Use the default shouldRetryRequest logic
		if (!shouldRetryRequest(axiosError)) {
			throw axiosError;
		}
	}

	// Create a promise that invokes the retry after the backOffDelay
	const onBackoffPromise = new Promise((resolve, reject) => {
		let delay = 0;
		// If enabled, check for 'Retry-After' header in response to use as delay
		if (
			config.checkRetryAfter &&
			axiosError.response?.headers?.['retry-after']
		) {
			const retryAfter = parseRetryAfter(
				axiosError.response.headers['retry-after'] as string,
			);
			if (
				retryAfter &&
				retryAfter > 0 &&
				retryAfter <= (config.maxRetryAfter ?? 0)
			) {
				delay = retryAfter;
			} else {
				reject(axiosError);
				return;
			}
		}

		// Now it's certain that a retry is supposed to happen. Incremenent the
		// counter, critical for linear and exp backoff delay calc. Note that
		// `config.currentRetryAttempt` is local to this function whereas
		// `(err.config as RaxConfig).raxConfig` is state that is tranferred across
		// retries. That is, we want to mutate `(err.config as
		// RaxConfig).raxConfig`. Another important note is about the definition of
		// `currentRetryAttempt`: When we are here becasue the first and actual
		// HTTP request attempt failed then `currentRetryAttempt` is still zero. We
		// have found that a retry is indeed required. Since that is (will be)
		// indeed the first retry it makes sense to now increase
		// `currentRetryAttempt` by 1. So that it is in fact 1 for the first retry
		// (as opposed to 0 or 2); an intuitive convention to use for the math
		// below.
		// biome-ignore lint/style/noNonNullAssertion: Checked above
		(axiosError.config as RaxConfig).raxConfig.currentRetryAttempt! += 1;

		// Store with shorter and more expressive variable name.
		// biome-ignore lint/style/noNonNullAssertion: Checked above
		const retrycount = (axiosError.config as RaxConfig).raxConfig
			.currentRetryAttempt!;

		// Calculate delay according to chosen strategy
		// Default to exponential backoff - formula: ((2^c - 1) / 2) * retryDelay
		if (delay === 0) {
			// Was not set by Retry-After logic
			if (config.backoffType === 'linear') {
				// The delay between the first (actual) attempt and the first retry
				// should be non-zero. Rely on the convention that `retrycount` is
				// equal to 1 for the first retry when we are in here (was once 0,
				// which was a bug -- see #122).
				delay = retrycount * 1000;
			} else if (config.backoffType === 'static') {
				// biome-ignore lint/style/noNonNullAssertion: Checked above
				delay = config.retryDelay!;
			} else {
				// Exponential backoff with retryDelay as base multiplier
				// biome-ignore lint/style/noNonNullAssertion: Checked above
				const baseDelay = config.retryDelay!;
				delay = ((2 ** retrycount - 1) / 2) * baseDelay;

				// Apply jitter if configured
				const jitter = config.jitter || 'none';
				if (jitter === 'full') {
					// Full jitter: random delay between 0 and calculated delay
					delay = Math.random() * delay;
				} else if (jitter === 'equal') {
					// Equal jitter: half fixed, half random
					delay = delay / 2 + Math.random() * (delay / 2);
				}
				// 'none' or any other value: no jitter applied
			}

			if (typeof config.maxRetryDelay === 'number') {
				delay = Math.min(delay, config.maxRetryDelay);
			}
		}

		setTimeout(resolve, delay);
	});

	if (config.onError) {
		await config.onError(axiosError);
	}

	// Return the promise in which recalls axios to retry the request
	return (
		Promise.resolve()
			.then(async () => onBackoffPromise)
			.then(async () => config.onRetryAttempt?.(axiosError))
			// biome-ignore lint/style/noNonNullAssertion: Checked above
			.then(async () => instance.request(axiosError.config!))
	);
}

/**
 * Determine based on config if we should retry the request.
 * @param err The AxiosError passed to the interceptor.
 */
export function shouldRetryRequest(error: AxiosError) {
	const config = (error.config as RaxConfig).raxConfig;

	// If there's no config, or retries are disabled, return.
	if (!config || config.retry === 0) {
		return false;
	}

	// Check if we are out of retry attempts first
	config.currentRetryAttempt ||= 0;
	if (config.currentRetryAttempt >= (config.retry ?? 0)) {
		return false;
	}

	// Only retry with configured HttpMethods.
	if (
		!error.config?.method ||
		!config.httpMethodsToRetry?.includes(error.config.method.toUpperCase())
	) {
		return false;
	}

	// For errors with responses, check status codes
	if (error.response?.status) {
		let isInRange = false;
		// biome-ignore lint/style/noNonNullAssertion: Checked above
		for (const [min, max] of config.statusCodesToRetry!) {
			const { status } = error.response;
			if (status >= min && status <= max) {
				isInRange = true;
				break;
			}
		}

		if (!isInRange) {
			return false;
		}
	}

	// For errors without responses (network errors, timeouts, etc.)
	// we allow retry as long as we haven't exceeded the retry limit
	// This includes: ETIMEDOUT, ENOTFOUND, ECONNABORTED, ECONNRESET, etc.

	return true;
}

/**
 * Acquire the raxConfig object from an AxiosError if available.
 * @param err The Axios error with a config object.
 */
export function getConfig(error: AxiosError) {
	if (error?.config) {
		return (error.config as RaxConfig).raxConfig;
	}
}

// Include this so `config.raxConfig` works easily.
// See https://github.com/JustinBeckwith/retry-axios/issues/64.
declare module 'axios' {
	export interface AxiosRequestConfig {
		raxConfig?: RetryConfig;
	}
}
