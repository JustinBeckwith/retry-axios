import axios, {AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse} from 'axios';

export interface RetryConfig {
  retry?: number;
  currentRetryAttempt?: number;
  retryDelay?: number;
  instance?: AxiosInstance;
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

function onError(err: AxiosError) {
  const config = (err.config as RaxConfig).raxConfig || {};
  config.currentRetryAttempt = config.currentRetryAttempt || 0;
  config.retry =
      (config.retry === undefined || config.retry === null) ? 3 : config.retry;
  config.retryDelay = config.retryDelay || 100;
  config.instance = config.instance || axios;

  // If there's no config, or retries are disabled, return.
  if (!config || config.retry === 0) {
    return Promise.reject(err);
  }

  // If this was anything other than a GET, return.
  if (!err.config.method || err.config.method.toLowerCase() !== 'get') {
    return Promise.reject(err);
  }

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
  if (err.response && err.response.status) {
    let isInRange = false;
    for (const [min, max] of retryRanges) {
      const status = err.response.status;
      if (status >= min && status <= max) {
        isInRange = true;
        break;
      }
    }
    if (!isInRange) {
      return Promise.reject(err);
    }
  }

  // If we are out of retry attempts, return
  config.currentRetryAttempt = config.currentRetryAttempt || 0;
  if (config.currentRetryAttempt >= config.retry) {
    return Promise.reject(err);
  }

  // Calculate time to wait with exponential backoff.
  // Formula: (2^c - 1 / 2) * 1000
  const delay = (Math.pow(2, config.currentRetryAttempt) - 1) / 2 * 1000;

  // We're going to retry!  Incremenent the counter.
  config.currentRetryAttempt += 1;

  // Create a promise that invokes the retry after the backOffDelay
  const backoff = new Promise(resolve => {
    setTimeout(resolve, delay);
  });

  // Return the promise in which recalls axios to retry the request
  (err.config as RaxConfig).raxConfig = config;
  return backoff.then(() => {
    return config.instance!.request(err.config);
  });
}

export function getConfig(err: AxiosError) {
  if (err && err.config) {
    return (err.config as RaxConfig).raxConfig;
  }
  return;
}
