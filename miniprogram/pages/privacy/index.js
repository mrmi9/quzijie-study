const env = require('../../config/env');

Page({
  data: {
    operatorName: env.operatorName || '待发布前配置',
    privacyContact: env.privacyContact || '待发布前配置'
  }
});
