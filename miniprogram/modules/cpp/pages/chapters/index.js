const repository = require('../../../../services/cppRepository');

Page({
  data: { loading: true, error: '', chapters: [] },

  onLoad() {
    this.loadChapters();
  },

  loadChapters() {
    this.setData({ loading: true, error: '' });
    repository.getChapters()
      .then((chapters) => this.setData({ chapters, loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '章节加载失败' }));
  },

  selectChapter(event) {
    const chapter = this.data.chapters.find((item) => item.id === event.currentTarget.dataset.id);
    if (!chapter) return;
    wx.navigateTo({
      url: `/modules/cpp/pages/setup/index?mode=chapter&chapterId=${chapter.id}&chapterName=${encodeURIComponent(chapter.name)}`
    });
  }
});
