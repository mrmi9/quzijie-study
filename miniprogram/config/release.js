// 体验版和正式版只读取本文件，不接受本地 Storage 覆盖。
// 443 由同机既有 Xray 使用，因此微信后台 request 合法域名也必须包含 :8443。
module.exports = {
  apiBaseUrl: 'https://api.qushuati.cloud:8443',
  operatorName: '米文立',
  privacyContact: '1130967204@qq.com'
};
