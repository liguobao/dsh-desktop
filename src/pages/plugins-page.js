(() => {
  const api = window.dshPluginManager
  const { actionButton, errorText, setFeedback, textElement, toggleButton, zh } = window.dshManagerUi
  const strings = zh ? {
    documentTitle: 'DSH 插件', appTitle: '插件', refresh: '刷新', docs: '文档', add: '添加插件', close: '关闭', cancel: '取消',
    installLabel: '直接从 npm 或 GitHub 安装',
    pluginSpecLabel: '插件包名或 GitHub 仓库',
    placeholder: '@scope/plugin@version 或 https://github.com/owner/repo', install: '安装', installing: '安装中…', downloading: '正在下载并安装…',
    hint: '支持 GitHub 仓库、Commit 和 Tree 地址；仓库地址优先安装最新 Tag，没有 Tag 时固定到默认分支当前 Commit。',
    buildLabel: '允许这个 GitHub 软件包运行安装和构建脚本；勾选前请先检查源码。', installed: '已安装', installedAll: '已安装插件', itemCount: count => `· ${count} 个`,
    openSourcePlugins: '开源插件', viewAllInstalled: '查看全部已安装插件', viewAllOnline: '查看全部开源插件',
    installedBack: '← 返回插件管理', installedAllHint: '管理用户插件，并查看此 profile 依赖的系统 Bundle。', catalogBack: '← 返回插件管理',
    discover: '开源插件', discoverLoading: '正在加载开源插件…',
    discoverHint: '目录来源于 GitHub dsh-plugin topic；安装前请先检查插件源码。',
    searchLabel: '搜索社区插件', searchPlaceholder: '按名称、描述或分类搜索',
    onlineCatalog: count => `开源目录 · ${count} 个`, offlineCatalog: count => `内置开源目录 · ${count} 个`,
    resultCount: count => `${count} 个结果`, page: (current, total) => `第 ${current} / ${total} 页`, previous: '上一页', next: '下一页',
    noMatches: '没有符合搜索条件的插件。', onlineEmpty: '暂无可安装的在线插件。', inspect: '查看源码', catalogInstall: '安装', catalogInstalled: '已安装',
    empty: '尚未安装用户插件。', system: '系统 Bundle', systemNote: 'web profile 运行所必需', loading: '正在加载…',
    enabled: '已启用', disabled: '已停用', invalid: '不是 DSH 插件', missing: '文件缺失', bundled: '随 Harness 提供',
    enable: '启用', disable: '停用', update: '在线更新', updating: '正在获取默认分支最新版…', uninstall: '卸载', confirmRemove: name => `确定要卸载 ${name} 吗？`,
    restartText: '插件设置已更改，需要重启 Harness 后生效。', restart: '立即重启', restarting: '正在重启…',
    installedMessage: '插件安装完成。', updated: '插件已更新。', upToDate: '已是最新版本。', removed: '插件已卸载。', changed: '插件状态已更新。',
    buildSkipped: '仓库需要运行构建脚本，当前插件尚未启用。检查源码后，勾选构建脚本授权并重新安装。',
    unavailable: '插件管理桥接不可用，请重新启动 DSH Desktop。', unavailableSummary: '不可用', unknownError: '插件操作失败。',
  } : {
    documentTitle: 'DSH Plugins', appTitle: 'Plugins', refresh: 'Refresh', docs: 'Documentation', add: 'Add plugin', close: 'Close', cancel: 'Cancel',
    installLabel: 'Install directly from npm or GitHub',
    pluginSpecLabel: 'Plugin package or GitHub repository',
    placeholder: '@scope/plugin@version or https://github.com/owner/repo', install: 'Install', installing: 'Installing…', downloading: 'Downloading and installing…',
    hint: 'Supports GitHub repository, commit, and tree URLs. Repository URLs use the latest tag, or pin the current default-branch commit when no tag exists.',
    buildLabel: 'Allow this GitHub package to run install and build scripts. Review its source first.', installed: 'Installed', installedAll: 'Installed plugins', itemCount: count => `· ${count} items`,
    openSourcePlugins: 'Open-source plugins', viewAllInstalled: 'View all installed plugins', viewAllOnline: 'View all open-source plugins',
    installedBack: '← Back to plugin manager', installedAllHint: 'Manage user plugins and inspect the system bundles required by this profile.', catalogBack: '← Back to plugin manager',
    discover: 'Open-source plugins', discoverLoading: 'Loading open-source plugins…',
    discoverHint: 'Cataloged from the GitHub dsh-plugin topic. Review a plugin\'s source before installing it.',
    searchLabel: 'Search community plugins', searchPlaceholder: 'Search by name, description, or category',
    onlineCatalog: count => `Open-source catalog · ${count}`, offlineCatalog: count => `Bundled open-source catalog · ${count}`,
    resultCount: count => `${count} result${count === 1 ? '' : 's'}`, page: (current, total) => `Page ${current} of ${total}`, previous: 'Previous', next: 'Next',
    noMatches: 'No plugins match this search.', onlineEmpty: 'No online plugins are available.', inspect: 'View source', catalogInstall: 'Install', catalogInstalled: 'Installed',
    empty: 'No user plugins are installed.', system: 'System bundles', systemNote: 'Required by the web profile', loading: 'Loading…',
    enabled: 'Enabled', disabled: 'Disabled', invalid: 'Not a DSH plugin', missing: 'Files missing', bundled: 'Bundled with Harness',
    enable: 'Enable', disable: 'Disable', update: 'Update online', updating: 'Fetching the latest default branch…', uninstall: 'Uninstall', confirmRemove: name => `Uninstall ${name}?`,
    restartText: 'Plugin settings changed. Restart Harness to apply them.', restart: 'Restart now', restarting: 'Restarting…',
    installedMessage: 'Plugin installed.', updated: 'Plugin updated.', upToDate: 'Already up to date.', removed: 'Plugin uninstalled.', changed: 'Plugin status updated.',
    buildSkipped: 'This repository requires build scripts, so the plugin was not enabled. Review the source, allow build scripts, and install it again.',
    unavailable: 'The plugin manager bridge is unavailable. Restart DSH Desktop.', unavailableSummary: 'Unavailable', unknownError: 'Plugin operation failed.',
  }

  const elements = {
    installedHeadingLabel: document.querySelector('#installed-heading-label'),
    installedCount: document.querySelector('#installed-count'),
    onlineHeadingLabel: document.querySelector('#online-heading-label'),
    onlineCount: document.querySelector('#online-count'),
    openInstall: document.querySelector('#open-install'),
    installDialog: document.querySelector('#install-dialog'),
    closeInstall: document.querySelector('#close-install'),
    cancelInstall: document.querySelector('#cancel-install'),
    spec: document.querySelector('#plugin-spec'),
    form: document.querySelector('#plugin-install-form'),
    install: document.querySelector('#plugin-install'),
    allowBuild: document.querySelector('#allow-build'),
    buildOption: document.querySelector('#build-option'),
    installFeedback: document.querySelector('#install-feedback'),
    feedback: document.querySelector('#plugin-feedback'),
    restartBanner: document.querySelector('#restart-banner'),
    restart: document.querySelector('#restart'),
    previewLoading: document.querySelector('#plugin-preview-loading'),
    previewList: document.querySelector('#plugin-preview-list'),
    previewEmpty: document.querySelector('#plugin-preview-empty'),
    list: document.querySelector('#plugin-list'),
    empty: document.querySelector('#plugin-empty'),
    system: document.querySelector('#system-list'),
    homeView: document.querySelector('#plugin-home-view'),
    homeNotices: document.querySelector('#home-notices'),
    installedView: document.querySelector('#installed-view'),
    installedNotices: document.querySelector('#installed-notices'),
    openInstalled: document.querySelector('#open-installed'),
    closeInstalled: document.querySelector('#close-installed'),
    installedAllHeadingLabel: document.querySelector('#installed-all-heading-label'),
    installedAllNote: document.querySelector('#installed-all-note'),
    catalogView: document.querySelector('#catalog-view'),
    catalogNotices: document.querySelector('#catalog-notices'),
    openCatalog: document.querySelector('#open-catalog'),
    closeCatalog: document.querySelector('#close-catalog'),
    discoverNote: document.querySelector('#discover-note'),
    discoverHint: document.querySelector('#discover-hint'),
    discoverSearch: document.querySelector('#plugin-search'),
    discoverLoading: document.querySelector('#discover-loading'),
    discoverList: document.querySelector('#discover-list'),
    discoverEmpty: document.querySelector('#discover-empty'),
    catalogPagination: document.querySelector('#catalog-pagination'),
    catalogPrevious: document.querySelector('#catalog-previous'),
    catalogNext: document.querySelector('#catalog-next'),
    catalogPageInfo: document.querySelector('#catalog-page-info'),
    onlinePreviewLoading: document.querySelector('#online-preview-loading'),
    onlinePreviewList: document.querySelector('#online-preview-list'),
    onlinePreviewEmpty: document.querySelector('#online-preview-empty'),
  }
  let busy = false
  let restartRequired = false
  let activeView = 'home'
  let dialogReturnFocus
  let catalogAvailable = false
  let loadGeneration = 0
  let catalog = { plugins: [], system: [] }
  let discovery = { plugins: [], categories: {}, online: false, loaded: false }
  let discoveryPreview = []
  let catalogPage = 1
  const CATALOG_PAGE_SIZE = 5

  function localize() {
    document.documentElement.lang = zh ? 'zh-CN' : 'en'
    document.title = strings.documentTitle
    document.querySelector('#app-title').textContent = strings.appTitle
    document.querySelector('#refresh').textContent = strings.refresh
    document.querySelector('#docs').textContent = strings.docs
    elements.openInstall.textContent = strings.add
    document.querySelector('#install-dialog-title').textContent = strings.add
    document.querySelector('#plugin-install-label').textContent = strings.installLabel
    document.querySelector('#plugin-spec-label').textContent = strings.pluginSpecLabel
    elements.spec.placeholder = strings.placeholder
    elements.install.textContent = strings.install
    elements.cancelInstall.textContent = strings.cancel
    elements.closeInstall.setAttribute('aria-label', strings.close)
    document.querySelector('#plugin-install-hint').textContent = strings.hint
    document.querySelector('#allow-build-label').textContent = strings.buildLabel
    elements.onlineHeadingLabel.textContent = strings.openSourcePlugins
    elements.openInstalled.setAttribute('aria-label', strings.viewAllInstalled)
    elements.openInstalled.title = strings.viewAllInstalled
    elements.openCatalog.setAttribute('aria-label', strings.viewAllOnline)
    elements.openCatalog.title = strings.viewAllOnline
    elements.closeInstalled.textContent = strings.installedBack
    elements.installedAllHeadingLabel.textContent = strings.installed
    document.querySelector('#installed-all-hint').textContent = strings.installedAllHint
    elements.closeCatalog.textContent = strings.catalogBack
    document.querySelector('#discover-heading').textContent = strings.discover
    elements.discoverNote.textContent = strings.discoverLoading
    elements.discoverHint.textContent = strings.discoverHint
    document.querySelector('#plugin-search-label').textContent = strings.searchLabel
    elements.discoverSearch.placeholder = strings.searchPlaceholder
    elements.discoverEmpty.textContent = strings.noMatches
    elements.catalogPrevious.textContent = strings.previous
    elements.catalogNext.textContent = strings.next
    elements.installedHeadingLabel.textContent = strings.installed
    elements.previewEmpty.textContent = strings.empty
    elements.empty.textContent = strings.empty
    elements.onlinePreviewEmpty.textContent = strings.onlineEmpty
    document.querySelector('#system-heading').textContent = strings.system
    document.querySelector('#system-note').textContent = strings.systemNote
    document.querySelector('#restart-text').textContent = strings.restartText
    elements.restart.textContent = strings.restart
    elements.installedCount.textContent = '…'
  }

  function showCatalog() {
    setFeedback(elements.feedback)
    elements.catalogNotices.append(elements.feedback, elements.restartBanner)
    elements.homeView.hidden = true
    elements.installedView.hidden = true
    elements.catalogView.hidden = false
    activeView = 'catalog'
    catalogPage = 1
    renderDiscovery()
    elements.closeCatalog.focus()
  }

  function showInstalled() {
    setFeedback(elements.feedback)
    elements.installedNotices.append(elements.feedback, elements.restartBanner)
    elements.homeView.hidden = true
    elements.catalogView.hidden = true
    elements.installedView.hidden = false
    activeView = 'installed'
    elements.closeInstalled.focus()
  }

  function showHome(focusTarget) {
    setFeedback(elements.feedback)
    elements.homeNotices.append(elements.feedback, elements.restartBanner)
    elements.catalogView.hidden = true
    elements.installedView.hidden = true
    elements.homeView.hidden = false
    activeView = 'home'
    focusTarget?.focus()
  }

  function updateBuildOption() {
    const github = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)/i.test(elements.spec.value.trim())
    elements.buildOption.hidden = !github
    if (!github) elements.allowBuild.checked = false
  }

  function openInstallDialog(spec = '', returnFocus = document.activeElement) {
    if (busy || !api) return
    dialogReturnFocus = returnFocus
    elements.spec.value = spec
    elements.allowBuild.checked = false
    updateBuildOption()
    setFeedback(elements.installFeedback)
    elements.installDialog.showModal()
    elements.spec.focus()
  }

  function closeInstallDialog() {
    if (!busy && elements.installDialog.open) elements.installDialog.close()
  }

  function setBusy(value, action = '') {
    busy = value
    document.body.setAttribute('aria-busy', String(value))
    elements.installDialog.setAttribute('aria-busy', String(value))
    for (const control of document.querySelectorAll('button, input')) {
      control.disabled = value || control.dataset.alwaysDisabled === 'true'
    }
    if (!value) {
      elements.openInstall.disabled = !catalogAvailable
      elements.openInstalled.disabled = !catalogAvailable
      elements.openCatalog.disabled = !catalogAvailable || !discovery.loaded
    }
    elements.install.textContent = value && action === 'install' ? strings.installing : strings.install
    if (value && action === 'install') {
      if (elements.installDialog.open) {
        setFeedback(elements.installFeedback, strings.downloading)
        elements.installDialog.focus()
      } else {
        setFeedback(elements.feedback, strings.downloading)
        elements.feedback.focus()
      }
    }
  }

  function pluginRow(plugin, system = false) {
    const row = document.createElement('div')
    row.className = 'item-row'
    row.setAttribute('role', 'listitem')
    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('div')
    title.className = 'item-title'
    title.append(textElement('span', 'item-name', plugin.name))
    if (plugin.version) title.append(textElement('span', 'item-version', `v${plugin.version}`))
    main.append(title)
    if (plugin.description) main.append(textElement('p', 'item-description', plugin.description))
    main.append(textElement('div', 'item-meta', system ? strings.bundled : `${plugin.source === 'github' ? 'GitHub' : 'npm'} · ${plugin.requested || 'npm'}`))
    const actions = document.createElement('div')
    actions.className = 'item-actions'
    if (system) actions.append(textElement('span', 'status', strings.enabled))
    else if (!plugin.installed) actions.append(textElement('span', 'status status--warning', strings.missing))
    else if (!plugin.bundle) actions.append(textElement('span', 'status status--warning', strings.invalid))
    else {
      actions.append(textElement('span', `status${plugin.enabled ? '' : ' status--off'}`, plugin.enabled ? strings.enabled : strings.disabled))
      actions.append(toggleButton(plugin.enabled, `${plugin.enabled ? strings.disable : strings.enable} ${plugin.name}`, () => void changeEnabled(plugin.name, !plugin.enabled)))
    }
    if (!system && plugin.source === 'github' && plugin.installed) {
      actions.append(actionButton(strings.update, 'button button--small', () => void update(plugin.name)))
    }
    if (!system) actions.append(actionButton(strings.uninstall, 'button button--danger button--small', () => void uninstall(plugin.name)))
    row.append(main, actions)
    return row
  }

  function installedGitHubKey(requested) {
    const match = /^github:([^#]+)(?:#(.*))?$/i.exec(requested ?? '')
    if (match === null) return undefined
    const path = /(?:^|&)path:(\/[^&]+)$/i.exec(match[2] ?? '')?.[1] ?? ''
    return `${match[1].toLowerCase()}#${path}`
  }

  function discoveryPluginInstalled(plugin) {
    if (plugin.source === 'npm') return catalog.plugins.some(candidate => candidate.name === plugin.npm)
    const key = `${plugin.repository.toLowerCase()}#${plugin.path ?? ''}`
    return catalog.plugins.some(candidate => installedGitHubKey(candidate.requested) === key)
  }

  function categoryLabel(plugin) {
    const labels = discovery.categories[plugin.category]
    return labels?.[zh ? 'zh' : 'en'] || plugin.category
  }

  function discoveryRow(plugin) {
    const row = document.createElement('div')
    row.className = 'item-row discovery-row'
    row.setAttribute('role', 'listitem')
    const main = document.createElement('div')
    main.className = 'item-main'
    const title = document.createElement('div')
    title.className = 'item-title'
    const source = actionButton(plugin.name, 'catalog-link', () => void openSource(plugin.url))
    source.setAttribute('aria-label', `${strings.inspect}: ${plugin.repository}`)
    title.append(source, textElement('span', 'catalog-category', categoryLabel(plugin)))
    main.append(title)
    const description = plugin.description?.[zh ? 'zh' : 'en'] || plugin.description?.en
    if (description) main.append(textElement('p', 'item-description', description))
    const metadata = [plugin.repository, plugin.npm ? 'npm' : 'GitHub']
    if (Number.isSafeInteger(plugin.stars)) metadata.push(`★ ${String(plugin.stars)}`)
    main.append(textElement('div', 'item-meta', metadata.join(' · ')))

    const installed = discoveryPluginInstalled(plugin)
    const actions = document.createElement('div')
    actions.className = 'item-actions'
    actions.append(actionButton(strings.inspect, 'button button--small', () => void openSource(plugin.url)))
    const installButton = actionButton(installed ? strings.catalogInstalled : strings.catalogInstall, 'button button--primary button--small', () => void installCatalogPlugin(plugin))
    installButton.disabled = installed
    if (installed) installButton.dataset.alwaysDisabled = 'true'
    actions.append(installButton)
    row.append(main, actions)
    return row
  }

  function latestInstalledPlugins() {
    return [...catalog.plugins].sort((left, right) => {
      const leftTime = Date.parse(left.installedAt ?? '')
      const rightTime = Date.parse(right.installedAt ?? '')
      const timeOrder = (Number.isFinite(rightTime) ? rightTime : -1) - (Number.isFinite(leftTime) ? leftTime : -1)
      return timeOrder || left.name.localeCompare(right.name)
    })
  }

  function addedTime(plugin) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plugin.added ?? '')
    if (match === null) return -1
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const timestamp = Date.UTC(year, month - 1, day)
    const date = new Date(timestamp)
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : -1
  }

  function latestDiscoveryPlugins() {
    return [...discovery.plugins].sort((left, right) =>
      addedTime(right) - addedTime(left)
      || left.repository.localeCompare(right.repository)
      || (left.path ?? '').localeCompare(right.path ?? '')
      || left.name.localeCompare(right.name),
    )
  }

  function randomDiscoveryPreview() {
    const plugins = [...discovery.plugins]
    for (let index = plugins.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1))
      const current = plugins[index]
      plugins[index] = plugins[randomIndex]
      plugins[randomIndex] = current
    }
    return plugins.slice(0, 3)
  }

  function matchingDiscoveryPlugins(query) {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return latestDiscoveryPlugins()
    return discovery.plugins.filter(plugin => {
      const labels = discovery.categories[plugin.category] ?? {}
      const haystack = [
        plugin.name,
        plugin.owner,
        plugin.repository,
        plugin.description?.en,
        plugin.description?.zh,
        labels.en,
        labels.zh,
      ].filter(Boolean).join(' ').toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    }).sort((left, right) => {
      const lowered = query.toLocaleLowerCase()
      const leftName = left.name.toLocaleLowerCase()
      const rightName = right.name.toLocaleLowerCase()
      const leftRank = lowered !== '' && leftName.startsWith(lowered) ? 1 : 0
      const rightRank = lowered !== '' && rightName.startsWith(lowered) ? 1 : 0
      return rightRank - leftRank || (right.stars ?? -1) - (left.stars ?? -1) || left.name.localeCompare(right.name)
    })
  }

  function renderDiscovery() {
    if (!discovery.loaded || activeView !== 'catalog') return
    elements.discoverLoading.hidden = true
    elements.discoverSearch.disabled = false
    const query = elements.discoverSearch.value.trim()
    const matches = matchingDiscoveryPlugins(query)
    const source = updateCatalogSourceNote()
    const pageCount = Math.max(1, Math.ceil(matches.length / CATALOG_PAGE_SIZE))
    catalogPage = Math.min(catalogPage, pageCount)
    const start = (catalogPage - 1) * CATALOG_PAGE_SIZE
    const pagePlugins = matches.slice(start, start + CATALOG_PAGE_SIZE)
    elements.discoverNote.textContent = query === '' ? source : `${strings.resultCount(matches.length)} · ${source}`
    elements.discoverList.replaceChildren(...pagePlugins.map(discoveryRow))
    elements.discoverList.hidden = matches.length === 0
    elements.discoverEmpty.hidden = matches.length !== 0
    elements.catalogPagination.hidden = matches.length === 0 || pageCount === 1
    elements.catalogPrevious.disabled = catalogPage === 1
    elements.catalogNext.disabled = catalogPage === pageCount
    elements.catalogPageInfo.textContent = strings.page(catalogPage, pageCount)
  }

  function updateCatalogSourceNote() {
    const source = discovery.loaded
      ? discovery.online ? strings.onlineCatalog(discovery.plugins.length) : strings.offlineCatalog(discovery.plugins.length)
      : strings.discoverLoading
    elements.onlineCount.textContent = discovery.loaded ? strings.itemCount(discovery.plugins.length) : '…'
    return source
  }

  function render() {
    const installed = latestInstalledPlugins()
    const installedPreview = installed.slice(0, 3)
    const onlinePreview = discovery.loaded ? discoveryPreview : []
    elements.previewLoading.hidden = true
    elements.onlinePreviewLoading.hidden = discovery.loaded
    elements.installedCount.textContent = strings.itemCount(catalog.plugins.length)
    elements.installedAllNote.textContent = strings.itemCount(catalog.plugins.length)
    elements.previewList.replaceChildren(...installedPreview.map(plugin => pluginRow(plugin)))
    elements.previewList.hidden = installedPreview.length === 0
    elements.previewEmpty.hidden = installedPreview.length !== 0
    elements.list.replaceChildren(...installed.map(plugin => pluginRow(plugin)))
    elements.list.hidden = installed.length === 0
    elements.empty.hidden = installed.length !== 0
    elements.system.replaceChildren(...catalog.system.map(plugin => pluginRow(plugin, true)))
    elements.onlinePreviewList.replaceChildren(...onlinePreview.map(discoveryRow))
    elements.onlinePreviewList.hidden = !discovery.loaded || onlinePreview.length === 0
    elements.onlinePreviewEmpty.hidden = !discovery.loaded || onlinePreview.length !== 0
    elements.openInstall.disabled = !catalogAvailable
    elements.openInstalled.disabled = !catalogAvailable
    elements.openCatalog.disabled = !catalogAvailable || !discovery.loaded
    elements.restartBanner.dataset.visible = String(restartRequired)
    updateCatalogSourceNote()
    if (activeView === 'catalog') renderDiscovery()
  }

  async function load() {
    const generation = ++loadGeneration
    catalogAvailable = false
    discovery = { plugins: [], categories: {}, online: false, loaded: false }
    discoveryPreview = []
    catalogPage = 1
    elements.openInstall.disabled = true
    elements.openCatalog.disabled = true
    elements.openInstalled.disabled = true
    if (!api) {
      elements.previewLoading.hidden = true
      elements.onlinePreviewLoading.hidden = true
      elements.installedCount.textContent = '—'
      elements.onlineCount.textContent = '—'
      elements.openInstall.disabled = true
      elements.openInstalled.disabled = true
      elements.openCatalog.disabled = true
      return setFeedback(elements.feedback, strings.unavailable, 'error')
    }
    elements.previewLoading.hidden = false
    elements.previewList.hidden = true
    elements.previewEmpty.hidden = true
    elements.list.hidden = true
    elements.empty.hidden = true
    elements.system.replaceChildren()
    elements.onlinePreviewLoading.hidden = false
    elements.onlinePreviewList.hidden = true
    elements.onlinePreviewEmpty.hidden = true
    elements.discoverLoading.hidden = false
    elements.discoverList.hidden = true
    elements.discoverEmpty.hidden = true
    elements.catalogPagination.hidden = true
    elements.discoverSearch.disabled = true
    elements.onlineCount.textContent = '…'
    elements.discoverNote.textContent = strings.discoverLoading
    const listTask = (async () => {
      let result
      try {
        result = await api.list()
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (generation !== loadGeneration) return
      if (!result?.ok) {
        elements.previewLoading.hidden = true
        elements.onlinePreviewLoading.hidden = true
        elements.installedCount.textContent = '—'
        elements.onlineCount.textContent = '—'
        elements.discoverLoading.hidden = true
        elements.openInstall.disabled = true
        elements.openInstalled.disabled = true
        elements.openCatalog.disabled = true
        setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
        return
      }
      catalog = result.catalog
      catalogAvailable = true
      render()
    })()
    const discoveryTask = (async () => {
      let result
      try {
        result = await api.discover()
      } catch {
        result = undefined
      }
      if (generation !== loadGeneration) return
      discovery = result?.ok
        ? { ...result.catalog, online: result.online === true, loaded: true }
        : { plugins: [], categories: {}, online: false, loaded: true }
      discoveryPreview = randomDiscoveryPreview()
      if (catalogAvailable) render()
    })()
    await Promise.all([listTask, discoveryTask])
  }

  async function installSpec(spec, allowBuildScripts, { fromDialog = false } = {}) {
    if (busy) return
    const feedback = fromDialog ? elements.installFeedback : elements.feedback
    setFeedback(feedback, fromDialog ? '' : strings.installing)
    setBusy(true, 'install')
    const result = await api.install(spec, allowBuildScripts)
    setBusy(false)
    if (!result?.ok) {
      setFeedback(feedback, errorText(result, strings.unknownError), 'error')
      if (fromDialog) elements.spec.focus()
      return
    }
    catalog = result.catalog
    catalogAvailable = true
    if (catalog.buildScriptsIgnored) {
      elements.spec.value = spec
      elements.buildOption.hidden = false
      setFeedback(elements.feedback)
      render()
      if (!elements.installDialog.open) {
        openInstallDialog(spec, activeView === 'catalog' ? elements.discoverSearch : elements.openInstall)
      }
      elements.buildOption.hidden = false
      setFeedback(elements.installFeedback, strings.buildSkipped, 'error')
      return
    } else {
      restartRequired = true
      elements.spec.value = ''
      elements.allowBuild.checked = false
      elements.buildOption.hidden = true
      if (elements.installDialog.open) elements.installDialog.close()
      setFeedback(elements.feedback, strings.installedMessage)
    }
    render()
  }

  async function install(event) {
    event.preventDefault()
    await installSpec(elements.spec.value, elements.allowBuild.checked, { fromDialog: true })
  }

  async function installCatalogPlugin(plugin) {
    await installSpec(plugin.spec, false)
  }

  async function openSource(url) {
    const result = await api.openSource(url)
    if (!result?.ok) setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
  }

  async function changeEnabled(name, enabled) {
    if (busy) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.setEnabled(name, enabled)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    restartRequired = true
    setFeedback(elements.feedback, strings.changed)
    render()
  }

  async function update(name) {
    if (busy) return
    setFeedback(elements.feedback, strings.updating)
    setBusy(true)
    const result = await api.update(name)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    if (catalog.upToDate) {
      setFeedback(elements.feedback, strings.upToDate)
    } else {
      restartRequired = true
      setFeedback(elements.feedback, catalog.buildScriptsIgnored ? strings.buildSkipped : strings.updated, catalog.buildScriptsIgnored ? 'error' : 'info')
    }
    render()
  }

  async function uninstall(name) {
    if (busy || !confirm(strings.confirmRemove(name))) return
    setFeedback(elements.feedback)
    setBusy(true)
    const result = await api.remove(name)
    setBusy(false)
    if (!result?.ok) return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    catalog = result.catalog
    restartRequired = true
    setFeedback(elements.feedback, strings.removed)
    render()
  }

  async function restart() {
    if (busy) return
    setBusy(true)
    elements.restart.textContent = strings.restarting
    const result = await api.restart()
    if (!result?.ok) {
      setBusy(false)
      elements.restart.textContent = strings.restart
      return setFeedback(elements.feedback, errorText(result, strings.unknownError), 'error')
    }
    window.close()
  }

  localize()
  elements.form.addEventListener('submit', install)
  elements.spec.addEventListener('input', updateBuildOption)
  elements.openInstall.addEventListener('click', () => openInstallDialog())
  elements.closeInstall.addEventListener('click', closeInstallDialog)
  elements.cancelInstall.addEventListener('click', closeInstallDialog)
  elements.installDialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault()
  })
  elements.installDialog.addEventListener('close', () => {
    setFeedback(elements.installFeedback)
    if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus()
    else if (activeView === 'catalog') elements.discoverSearch.focus()
    else elements.openInstall.focus()
    dialogReturnFocus = undefined
  })
  elements.discoverSearch.addEventListener('input', () => {
    catalogPage = 1
    renderDiscovery()
  })
  elements.catalogPrevious.addEventListener('click', () => {
    catalogPage -= 1
    renderDiscovery()
  })
  elements.catalogNext.addEventListener('click', () => {
    catalogPage += 1
    renderDiscovery()
  })
  elements.openInstalled.addEventListener('click', showInstalled)
  elements.closeInstalled.addEventListener('click', () => showHome(elements.openInstalled))
  elements.openCatalog.addEventListener('click', showCatalog)
  elements.closeCatalog.addEventListener('click', () => showHome(elements.openCatalog))
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || elements.installDialog.open || busy) return
    if (activeView === 'catalog') showHome(elements.openCatalog)
    else if (activeView === 'installed') showHome(elements.openInstalled)
  })
  elements.restart.addEventListener('click', restart)
  document.querySelector('#refresh').addEventListener('click', () => void load())
  document.querySelector('#docs').addEventListener('click', () => void api?.openDocs())
  void load()
})()
