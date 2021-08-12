import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
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
   * Function to invoke when a retry attempt is made.
   */
  onRetryAttempt?: (err: AxiosError) => void;

  /**
   * Function to invoke which determines if you should retry
   */
  shouldRetry?: (err: AxiosError) => boolean;

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
  instance = instance || axios;
  return instance.interceptors.response.use(onFulfilled, onError);
}

/**
 * Eject the Axios interceptor that is providing retry capabilities.
 * @param interceptorId The interceptorId provided in the config.
 * @param instance The axios instance using this interceptor.
 */
export function detach(interceptorId: number, instance?: AxiosInstance) {
  instance = instance || axios;
  instance.interceptors.response.eject(interceptorId);
}

function onFulfilled(res: AxiosResponse) {
  return res;
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
function normalizeArray<T>(obj?: T[]): T[] | undefined {
  const arr: T[] = [];
  if (!obj) {
    return undefined;
  }
  if (Array.isArray(obj)) {
    return obj;
  }
  if (typeof obj === 'object') {
    Object.keys(obj).forEach(key => {
      if (typeof key === 'number') {
        arr[key] = obj[key];
      }
    });
  }
  return arr;
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

function onError(err: AxiosError) {
  if (axios.isCancel(err)) {
    return Promise.reject(err);
  }

  const config = getConfig(err) || {};
  config.currentRetryAttempt = config.currentRetryAttempt || 0;
  config.retry = typeof config.retry === 'number' ? config.retry : 3;
  config.retryDelay =
    typeof config.retryDelay === 'number' ? config.retryDelay : 100;
  config.instance = config.instance || axios;
  config.backoffType = config.backoffType || 'exponential';
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
    typeof config.maxRetryAfter === 'number' ? config.maxRetryAfter : 60000 * 5;

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
  err.config = err.config || {}; // allow for wider range of errors
  (err.config as RaxConfig).raxConfig = {...config};

  // Determine if we should retry the request
  const shouldRetryFn = config.shouldRetry || shouldRetryRequest;
  if (!shouldRetryFn(err)) {
    return Promise.reject(err);
  }

  // Create a promise that invokes the retry after the backOffDelay
  const onBackoffPromise = new Promise((resolve, reject) => {
    let delay = 0;
    // If enabled, check for 'Retry-After' header in response to use as delay
    if (
      config.checkRetryAfter &&
      err.response &&
      err.response.headers['retry-after']
    ) {
      const retryAfter = parseRetryAfter(err.response.headers['retry-after']);
      if (retryAfter && retryAfter > 0 && retryAfter <= config.maxRetryAfter!) {
        delay = retryAfter;
      } else {
        return reject(err);
      }
    }
    // Else calculate delay according to chosen strategy
    // Default to exponential backoff - formula: (2^c - 1 / 2) * 1000
    else {
      if (config.backoffType === 'linear') {
        delay = config.currentRetryAttempt! * 1000;
      } else if (config.backoffType === 'static') {
        delay = config.retryDelay!;
      } else {
        delay = ((Math.pow(2, config.currentRetryAttempt!) - 1) / 2) * 1000;
      }
    }
    // We're going to retry!  Incremenent the counter.
    (err.config as RaxConfig).raxConfig!.currentRetryAttempt! += 1;
    setTimeout(resolve, delay);
  });

  // Notify the user if they added an `onRetryAttempt` handler
  const onRetryAttemptPromise = config.onRetryAttempt
    ? Promise.resolve(config.onRetryAttempt(err))
    : Promise.resolve();

  // Return the promise in which recalls axios to retry the request
  return Promise.resolve()
    .then(() => onBackoffPromise)
    .then(() => onRetryAttemptPromise)
    .then(() => config.instance!.request(err.config));
}

/**
 * Determine based on config if we should retry the request.
 * @param err The AxiosError passed to the interceptor.
 */
export function shouldRetryRequest(err: AxiosError) {
  const config = (err.config as RaxConfig).raxConfig;

  // If there's no config, or retries are disabled, return.
  if (!config || config.retry === 0) {
    return false;
  }

  // Check if this error has no response (ETIMEDOUT, ENOTFOUND, etc)
  if (
    !err.response &&
    (config.currentRetryAttempt || 0) >= config.noResponseRetries!
  ) {
    return false;
  }

  // Only retry with configured HttpMethods.
  if (
    !err.config.method ||
    config.httpMethodsToRetry!.indexOf(err.config.method.toUpperCase()) < 0
  ) {
    return false;
  }

  // If this wasn't in the list of status codes where we want
  // to automatically retry, return.
  if (err.response && err.response.status) {
    let isInRange = false;
    for (const [min, max] of config.statusCodesToRetry!) {
      const status = err.response.status;
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
  config.currentRetryAttempt = config.currentRetryAttempt || 0;
  return config.currentRetryAttempt < config.retry!;
}

/**
 * Acquire the raxConfig object from an AxiosError if available.
 * @param err The Axios error with a config object.
 */
export function getConfig(err: AxiosError) {
  if (err && err.config) {
    return (err.config as RaxConfig).raxConfig;
  }
  return;
}

// Include this so `config.raxConfig` works easily.
// See https://github.com/JustinBeckwith/retry-axios/issues/64.
declare module 'axios' {
  export interface AxiosRequestConfig {
    raxConfig?: RetryConfig;
  }
}
