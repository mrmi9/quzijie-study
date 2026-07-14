const request = require('../../utils/request');

module.exports = {
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
  getMe: () => request({ url: '/api/v1/users/me' })
};
