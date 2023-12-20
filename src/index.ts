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
	 * The amount of time to initially delay the retry.  Defaults to 100.
	 */
	retryDelay?: number;

	/**
	 * The instance of the axios object to which the interceptor is attached.
	 */
	instance?: AxiosInstance;

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
	 */
	onRetryAttempt?: (error: AxiosError) => void | Promise<void>;

	/**
	 * Function to invoke which determines if you should retry
	 */
	shouldRetry?: (error: AxiosError) => boolean;

	/**
	 * When there is no response, the number of retries to attempt. Defaults to 2.
	 */
	noResponseRetries?: number;

	/**
	 * Backoff Type; 'linear', 'static' or 'exponential'.
	 */
	backoffType?: 'linear' | 'static' | 'exponential';

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
}

export type RaxConfig = {
	raxConfig: RetryConfig;
} & AxiosRequestConfig;

/**
 * Attach the interceptor to the Axios instance.
 * @param instance The optional Axios instance on which to attach the
 * interceptor.
 * @returns The id of the interceptor attached to the axios instance.
 */
export function attach(instance?: AxiosInstance) {
	instance ||= axios;
	return instance.interceptors.response.use(
		onFulfilled,
		async (error: AxiosError) => onError(instance, error),
	);
}

/**
 * Eject the Axios interceptor that is providing retry capabilities.
 * @param interceptorId The interceptorId provided in the config.
 * @param instance The axios instance using this interceptor.
 */
export function detach(interceptorId: number, instance?: AxiosInstance) {
	instance ||= axios;
	instance.interceptors.response.eject(interceptorId);
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
	config.instance ||= instance;
	config.backoffType ||= 'exponential';
	config.httpMethodsToRetry = normalizeArray(config.httpMethodsToRetry) || [
		'GET',
		'HEAD',
		'PUT',
		'OPTIONS',
		'DELETE',
	];
	config.noResponseRetries =
		typeof config.noResponseRetries === 'number' ? config.noResponseRetries : 2;
	config.checkRetryAfter =
		typeof config.checkRetryAfter === 'boolean' ? config.checkRetryAfter : true;
	config.maxRetryAfter =
		typeof config.maxRetryAfter === 'number'
			? config.maxRetryAfter
			: 60_000 * 5;

	// If this wasn't in the list of status codes where we want
	// to automatically retry, return.
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
	config.statusCodesToRetry =
		normalizeArray(config.statusCodesToRetry) || retryRanges;

	// Put the config back into the err
	const axiosError = error as AxiosError;

	(axiosError as any).config = axiosError.config || {}; // Allow for wider range of errors
	(axiosError.config as RaxConfig).raxConfig = {...config};

	// Determine if we should retry the request
	const shouldRetryFunction = config.shouldRetry || shouldRetryRequest;
	if (!shouldRetryFunction(axiosError)) {
		throw axiosError;
	}

	// Create a promise that invokes the retry after the backOffDelay
	const onBackoffPromise = new Promise((resolve, reject) => {
		let delay = 0;
		// If enabled, check for 'Retry-After' header in response to use as delay
		if (config.checkRetryAfter && axiosError.response?.headers['retry-after']) {
			const retryAfter = parseRetryAfter(
				axiosError.response.headers['retry-after'] as string,
			);
			if (retryAfter && retryAfter > 0 && retryAfter <= config.maxRetryAfter!) {
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
		(axiosError.config as RaxConfig).raxConfig.currentRetryAttempt! += 1;

		// Store with shorter and more expressive variable name.
		const retrycount = (axiosError.config as RaxConfig).raxConfig
			.currentRetryAttempt!;

		// Calculate delay according to chosen strategy
		// Default to exponential backoff - formula: ((2^c - 1) / 2) * 1000
		if (delay === 0) {
			// Was not set by Retry-After logic
			if (config.backoffType === 'linear') {
				// The delay between the first (actual) attempt and the first retry
				// should be non-zero. Rely on the convention that `retrycount` is
				// equal to 1 for the first retry when we are in here (was once 0,
				// which was a bug -- see #122).
				delay = retrycount * 1000;
			} else if (config.backoffType === 'static') {
				delay = config.retryDelay!;
			} else {
				delay = ((2 ** retrycount - 1) / 2) * 1000;
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
	return Promise.resolve()
		.then(async () => onBackoffPromise)
		.then(async () => config.onRetryAttempt?.(axiosError))
		.then(async () => config.instance!.request(axiosError.config!));
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

	// Check if this error has no response (ETIMEDOUT, ENOTFOUND, etc)
	if (
		!error.response &&
		(config.currentRetryAttempt || 0) >= config.noResponseRetries!
	) {
		return false;
	}

	// Only retry with configured HttpMethods.
	if (
		!error.config?.method ||
		!config.httpMethodsToRetry!.includes(error.config.method.toUpperCase())
	) {
		return false;
	}

	// If this wasn't in the list of status codes where we want
	// to automatically retry, return.
	if (error.response?.status) {
		let isInRange = false;
		for (const [min, max] of config.statusCodesToRetry!) {
			const {status} = error.response;
			if (status >= min && status <= max) {
				isInRange = true;
				break;
			}
		}

		if (!isInRange) {
			return false;
		}
	}

	// If we are out of retry attempts, return
	config.currentRetryAttempt ||= 0;
	if (config.currentRetryAttempt >= config.retry!) {
		return false;
	}

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
