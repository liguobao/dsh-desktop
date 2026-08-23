(() => {
  const query = new URLSearchParams(location.search)
  const zh = query.get('lang') === 'zh'
  const projectUrl = 'https://github.com/liguobao/dsh-desktop'
  const strings = zh ? {
      documentTitle: '关于 DSH Desktop',
      description: 'DeepSeek Harness 的社区桌面客户端',
      versions: '版本',
      releasePolicy: '内置 Harness 随 DSH Desktop 版本统一更新。',
      source: '源代码',
      sourceDescription: '在 GitHub 查看发布版本、反馈问题或参与贡献。',
      community: '独立社区项目，并非 DeepSeek 官方应用。',
    } : {
      documentTitle: 'About DSH Desktop',
      description: 'Community desktop wrapper for DeepSeek Harness',
      versions: 'Versions',
      releasePolicy: 'The bundled Harness version updates with DSH Desktop releases.',
      source: 'Source code',
      sourceDescription: 'View releases, report issues, or contribute on GitHub.',
      community: 'An independent community project, not an official DeepSeek application.',
    }

  function version(name) {
    const value = query.get(name)?.trim()
    return value ? `v${value.replace(/^v/, '')}` : '—'
  }

  document.documentElement.lang = zh ? 'zh-CN' : 'en'
  document.title = strings.documentTitle
  document.querySelector('#product-description').textContent = strings.description
  document.querySelector('#versions-heading').textContent = strings.versions
  document.querySelector('#release-policy').textContent = strings.releasePolicy
  document.querySelector('#source-heading').textContent = strings.source
  document.querySelector('#source-description').textContent = strings.sourceDescription
  document.querySelector('#community-note').textContent = strings.community
  document.querySelector('#desktop-version').textContent = version('desktop')
  document.querySelector('#dsh-version').textContent = version('dsh')
  document.querySelector('#remote-version').textContent = version('remote')
  document.querySelector('#file-viewer-version').textContent = version('fileViewer')
  document.querySelector('#codex-subagent-version').textContent = version('codexSubagent')
  document.querySelector('#project-link').href = projectUrl
  document.querySelector('#project-url').textContent = projectUrl.replace(/^https:\/\//, '')
})()
