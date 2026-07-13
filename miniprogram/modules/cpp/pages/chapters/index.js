const createSubjectRepository = require('../../../../services/subjectRepository');
const registry = require('../../../../config/subjectRegistry');

Page({
  data: { subjectId: 'cpp', subjectName: 'C/C++', loading: true, error: '', chapters: [] },

  onLoad(options) {
    const subject = registry.getSubject(options.subjectId) || registry.getSubject('cpp');
    this.repository = createSubjectRepository(subject.id);
    this.setData({ subjectId: subject.id, subjectName: subject.name });
    wx.setNavigationBarTitle({ title: `${subject.name} 章节` });
    this.loadChapters();
  },

  loadChapters() {
    this.setData({ loading: true, error: '' });
    return this.repository.getChapters()
      .then((chapters) => this.setData({ chapters, loading: false }))
      .catch((error) => this.setData({ loading: false, error: error.message || '章节加载失败' }));
  },

  selectChapter(event) {
    const chapter = this.data.chapters.find((item) => item.id === event.currentTarget.dataset.id);
    if (!chapter) return;
    wx.navigateTo({
      url: `/modules/cpp/pages/setup/index?mode=chapter&subjectId=${this.data.subjectId}&chapterId=${chapter.id}&chapterName=${encodeURIComponent(chapter.name)}`
    });
  }
});
