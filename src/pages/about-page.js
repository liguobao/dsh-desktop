(() => {
  const query = new URLSearchParams(location.search)
  const zh = query.get('lang') === 'zh'
  const projectUrl = 'https://github.com/liguobao/dsh-desktop'
  const strings = zh ? {
      documentTitle: '关于 DSH Desktop',
      description: 'DeepSeek Harness 的社区桌面客户端',
      versions: '版本',
      releasePolicy: '内置 Harness 随 DSH Desktop 版本统一更新。',
      runtime: '运行环境',
      runtimeDescription: '修复本地启动器和内置插件，然后重启 Harness。',
      repairTitle: '运行环境',
      repairReady: '准备就绪',
      repairButton: '修复并重启',
      repairing: '正在修复…',
      repaired: '修复完成，正在重启 Harness…',
      repairFailed: '修复失败',
      repairUnavailable: '当前版本无法从此页面触发修复',
      source: '源代码',
      sourceDescription: '在 GitHub 查看发布版本、反馈问题或参与贡献。',
      community: '独立社区项目，并非 DeepSeek 官方应用。',
    } : {
      documentTitle: 'About DSH Desktop',
      description: 'Community desktop wrapper for DeepSeek Harness',
      versions: 'Versions',
      releasePolicy: 'The bundled Harness version updates with DSH Desktop releases.',
      runtime: 'Runtime',
      runtimeDescription: 'Repair local launchers and bundled plugins, then restart Harness.',
      repairTitle: 'Runtime environment',
      repairReady: 'Ready',
      repairButton: 'Repair and Restart',
      repairing: 'Repairing…',
      repaired: 'Repair complete. Restarting Harness…',
      repairFailed: 'Repair failed',
      repairUnavailable: 'Repair is not available from this page',
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
  document.querySelector('#repair-heading').textContent = strings.runtime
  document.querySelector('#repair-description').textContent = strings.runtimeDescription
  document.querySelector('#repair-title').textContent = strings.repairTitle
  document.querySelector('#repair-status').textContent = strings.repairReady
  document.querySelector('#repair-button').textContent = strings.repairButton
  document.querySelector('#source-heading').textContent = strings.source
  document.querySelector('#source-description').textContent = strings.sourceDescription
  document.querySelector('#community-note').textContent = strings.community
  document.querySelector('#desktop-version').textContent = version('desktop')
  document.querySelector('#dsh-version').textContent = version('dsh')
  document.querySelector('#remote-version').textContent = version('remote')
  document.querySelector('#file-viewer-version').textContent = version('fileViewer')
  document.querySelector('#project-link').href = projectUrl
  document.querySelector('#project-url').textContent = projectUrl.replace(/^https:\/\//, '')

  const repairButton = document.querySelector('#repair-button')
  const repairStatus = document.querySelector('#repair-status')
  repairButton.addEventListener('click', async () => {
    if (window.dshDesktop?.repairEnvironment === undefined) {
      repairStatus.textContent = strings.repairUnavailable
      return
    }
    repairButton.disabled = true
    repairStatus.textContent = strings.repairing
    try {
      const result = await window.dshDesktop.repairEnvironment()
      if (result?.ok) {
        repairStatus.textContent = strings.repaired
      } else {
        repairStatus.textContent = result?.error || result?.report?.summary || strings.repairFailed
        repairButton.disabled = false
      }
    } catch (error) {
      repairStatus.textContent = error instanceof Error ? error.message : String(error)
      repairButton.disabled = false
    }
  })
})()
