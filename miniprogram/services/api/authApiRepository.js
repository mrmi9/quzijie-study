const request = require('../../utils/request');

module.exports = {
  loginWithCloudIdentity: () => request({
    url: '/api/v1/auth/wechat/cloud-login',
    method: 'POST',
    skipAuthRefresh: true,
    skipAuthRedirect: true
  }),
  loginWithWechatCode: (code) => request({
    url: '/api/v1/auth/wechat/login',
    method: 'POST',
    data: { code },
    skipAuthRefresh: true,
    skipAuthRedirect: true
  }),
  refresh: (refreshToken) => request({
    url: '/api/v1/auth/refresh',
    method: 'POST',
    data: { refreshToken },
    skipAuthRefresh: true,
    skipAuthRedirect: true
  }),
  logout: (refreshToken) => request({
    url: '/api/v1/auth/logout',
    method: 'POST',
    data: { refreshToken },
    skipAuthRefresh: true,
    skipAuthRedirect: true
  }),
  getMe: () => request({ url: '/api/v1/users/me' }),
  deleteMe: () => request({ url: '/api/v1/users/me', method: 'DELETE' })
};
