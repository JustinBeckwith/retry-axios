import axios, {AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse} from 'axios';

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
}

export type RaxConfig = {
  raxConfig: RetryConfig
}&AxiosRequestConfig;

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

// tslint:disable-next-line no-any
const values = (objOrArray: {[key: string]: any}) => {
  return Object.keys(objOrArray).map((key: string) => objOrArray[key]);
};

function onError(err: AxiosError) {
  const config = (err.config as RaxConfig).raxConfig || {};
  config.currentRetryAttempt = config.currentRetryAttempt || 0;
  config.retry =
      (config.retry === undefined || config.retry === null) ? 3 : config.retry;
  config.retryDelay = config.retryDelay || 100;
  config.instance = config.instance || axios;
  config.httpMethodsToRetry = values(
      config.httpMethodsToRetry || ['GET', 'HEAD', 'PUT', 'OPTIONS', 'DELETE']);
  config.noResponseRetries = (config.noResponseRetries === undefined ||
                              config.noResponseRetries === null) ?
      2 :
      config.noResponseRetries;

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
    [100, 199], [429, 429], [500, 599]
  ];
  config.statusCodesToRetry =
      values(config.statusCodesToRetry || retryRanges).map(values);

  // Put the config back into the err
  (err.config as RaxConfig).raxConfig = config;

  // Determine if we should retry the request
  const shouldRetryFn = config.shouldRetry || shouldRetryRequest;
  if (!shouldRetryFn(err)) {
    return Promise.reject(err);
  }

  // Create a promise that invokes the retry after the backOffDelay
  const onBackoffPromise = new Promise((resolve) => {
    // Calculate time to wait with exponential backoff.
    // Formula: (2^c - 1 / 2) * 1000
    const delay = (Math.pow(2, config.currentRetryAttempt!) - 1) / 2 * 1000;

    // We're going to retry!  Incremenent the counter.
    (err.config as RaxConfig).raxConfig!.currentRetryAttempt! += 1;
    setTimeout(resolve, delay);
  });

  // Notify the user if they added an `onRetryAttempt` handler
  const onRetryAttemptPromise = (config.onRetryAttempt) ?
      Promise.resolve(config.onRetryAttempt(err)) :
      Promise.resolve();

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
function shouldRetryRequest(err: AxiosError) {
  const config = (err.config as RaxConfig).raxConfig;

  // If there's no config, or retries are disabled, return.
  if (!config || config.retry === 0) {
    return false;
  }

  // Check if this error has no response (ETIMEDOUT, ENOTFOUND, etc)
  if (!err.response &&
      ((config.currentRetryAttempt || 0) >= config.noResponseRetries!)) {
    return false;
  }

  // Only retry with configured HttpMethods.
  if (!err.config.method ||
      config.httpMethodsToRetry!.indexOf(err.config.method.toUpperCase()) < 0) {
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
  if (config.currentRetryAttempt >= config.retry!) {
    return false;
  }

  return true;
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
