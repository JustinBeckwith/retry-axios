const axios = require('axios');
const nock = require('nock');
const rax = require('retry-axios');

describe('retry-axios with Jest', () => {
  let axiosInstance;
  let interceptorId;

  beforeEach(() => {
    axiosInstance = axios.create();
    axiosInstance.defaults.raxConfig = {
      instance: axiosInstance
    };
    interceptorId = rax.attach(axiosInstance);
  });

  afterEach(() => {
    nock.cleanAll();
    if (interceptorId !== undefined) {
      rax.detach(interceptorId, axiosInstance);
    }
  });

  test('should retry failed requests', async () => {
    const url = 'https://api.example.com';

    const scope = nock(url)
      .get('/data')
      .reply(500, { error: 'Server Error' })
      .get('/data')
      .reply(200, { success: true });

    const response = await axiosInstance.get(`${url}/data`, {
      raxConfig: {
        retry: 3,
        retryDelay: 100,
        backoffType: 'static'
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true });

    scope.done();
  });

  test('should respect retry count', async () => {
    const url = 'https://api.example.com';

    const scope = nock(url)
      .get('/fail')
      .times(3)
      .reply(500, { error: 'Server Error' });

    const config = {
      raxConfig: {
        retry: 2,
        retryDelay: 10,
        backoffType: 'static'
      }
    };

    await expect(
      axiosInstance.get(`${url}/fail`, config)
    ).rejects.toThrow();

    scope.done();
  });

  test('should call onRetryAttempt callback', async () => {
    const url = 'https://api.example.com';
    const onRetryAttempt = jest.fn().mockResolvedValue(undefined);

    const scope = nock(url)
      .get('/retry')
      .reply(500)
      .get('/retry')
      .reply(200, { success: true });

    await axiosInstance.get(`${url}/retry`, {
      raxConfig: {
        retry: 3,
        retryDelay: 10,
        backoffType: 'static',
        onRetryAttempt
      }
    });

    expect(onRetryAttempt).toHaveBeenCalledTimes(1);

    scope.done();
  });

  test('should call onError callback', async () => {
    const url = 'https://api.example.com';
    const onError = jest.fn().mockResolvedValue(undefined);

    const scope = nock(url)
      .get('/error')
      .reply(500)
      .get('/error')
      .reply(200, { success: true });

    await axiosInstance.get(`${url}/error`, {
      raxConfig: {
        retry: 3,
        retryDelay: 10,
        backoffType: 'static',
        onError
      }
    });

    expect(onError).toHaveBeenCalledTimes(1);

    scope.done();
  });
});
