window.__ModuleLoader__.load({
  id: '@dsh-desktop/integration',
  factory: (require) => {
    const module = { exports: {} }
    const bridge = globalThis.dshDesktop
    const React = require('react')

    const NS = 'dsh-desktop'
    const STYLE_ID = '@dsh-desktop/integration/actions'
    const WORKSPACE_ACTIONS_MARKER = 'dshDesktopWorkspaceActions'
    const inject = ['sessions', 'workspaces', 'locale', 'slots']
    const dictionaries = {
      zh: {
        'open.editor': '用编辑器打开',
        'open.fileManager': '打开文件夹',
        'update.download': '下载 v{version}',
        'update.downloading': '下载中 {progress}%',
        'update.restart': '重启以更新',
      },
      en: {
        'open.editor': 'Open in Editor',
        'open.fileManager': 'Open Folder',
        'update.download': 'Download v{version}',
        'update.downloading': 'Downloading {progress}%',
        'update.restart': 'Restart to Update',
      },
    }

    function iconElement(kind) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('fill', 'currentColor')
      if (kind === 'editor') {
        path.setAttribute('fill-rule', 'evenodd')
        path.setAttribute('d', 'M13.25 1.2 7 7.05 3.5 4.35 1.5 6.15 4.25 8 1.5 9.85l2 1.8L7 8.95l6.25 5.85 1.25-.6V1.8l-1.25-.6Zm0 3v7.6L8.9 8l4.35-3.8Z')
      } else {
        path.setAttribute('d', 'M2.42 2.25h3.03c.45 0 .87.22 1.12.6l.48.72h6.53c.83 0 1.5.67 1.5 1.5v6.93c0 .97-.78 1.75-1.75 1.75H2.42A1.5 1.5 0 0 1 .92 12V3.75c0-.83.67-1.5 1.5-1.5Zm0 1.3a.2.2 0 0 0-.2.2V12c0 .25.2.45.45.45h10.66c.25 0 .45-.2.45-.45V5.07a.2.2 0 0 0-.2-.2H6.35L5.5 3.6a.12.12 0 0 0-.1-.05H2.42Z')
      }
      svg.append(path)
      return svg
    }

    async function requestNativeOpen(path, intent) {
      const result = await bridge.openPath(path, intent)
      if (result?.ok !== true) throw new Error(result?.error ?? 'Desktop path open failed')
    }

    function installStyle() {
      if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
      const style = document.createElement('style')
      style.dataset.plugin = '@dsh-desktop/integration'
      style.dataset.pluginCss = STYLE_ID
      style.textContent = [
        '.dshDesktopWorkspaceSeparator{height:1px;background:var(--dsw-alias-border-l3);margin:4px 8px}',
        '.dshDesktopUpdateButton{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;flex:none;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer}',
        '.dshDesktopUpdateButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dshDesktopUpdateButton:disabled{opacity:.55;cursor:default}',
      ].join('')
      document.head.append(style)
      return () => style.remove()
    }

    function workspaceRows() {
      return Array.from(document.querySelectorAll('[role="treeitem"][aria-expanded]'))
        .filter(row => row.querySelectorAll('button').length >= 2)
    }

    function createMenuAction(template, label, kind, path, intent) {
      const wrapper = template.cloneNode(true)
      wrapper.dataset.dshDesktopAction = kind
      const button = wrapper.querySelector('button[role="menuitem"]')
      if (button === null) return undefined
      button.removeAttribute('disabled')
      button.removeAttribute('aria-expanded')
      button.removeAttribute('aria-haspopup')
      const spans = button.querySelectorAll('span')
      if (spans.length < 2) return undefined
      spans[0].replaceChildren(iconElement(kind))
      spans[1].textContent = label
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        void requestNativeOpen(path, intent).catch((error) => {
          console.warn(`DSH Desktop could not open the workspace with intent ${intent}.`, error)
        })
      })
      return wrapper
    }

    function installWorkspaceMenuActions(workspaces, t) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
      let pendingPath
      let pendingAt = 0
      let pendingTimer

      const injectActions = (menu) => {
        if (pendingPath === undefined || performance.now() - pendingAt > 1500) return false
        if (!(menu instanceof HTMLElement) || menu.dataset[WORKSPACE_ACTIONS_MARKER] === 'true') return false
        const viewport = Array.from(menu.children).find(child => child.getAttribute('role') === 'presentation')
        if (!(viewport instanceof HTMLElement)) return false
        const menuItems = Array.from(viewport.children)
          .map(child => child.querySelector(':scope > button[role="menuitem"]'))
          .filter(button => button !== null)
        const labels = menuItems.map(button => button.textContent?.trim())
        const isWorkspaceMenu = menuItems.length === 2
          && ['Rename', '重命名'].includes(labels[0])
          && ['Delete workspace', '删除工作区'].includes(labels[1])
        if (!isWorkspaceMenu) return false
        const template = menuItems[0].parentElement
        if (!(template instanceof HTMLElement)) return false

        const editor = createMenuAction(template, t('open.editor'), 'editor', pendingPath, 'editor')
        const fileManager = createMenuAction(template, t('open.fileManager'), 'fileManager', pendingPath, 'default')
        if (editor === undefined || fileManager === undefined) return false
        const separator = document.createElement('div')
        separator.className = 'dshDesktopWorkspaceSeparator'
        separator.setAttribute('role', 'separator')
        const fragment = document.createDocumentFragment()
        fragment.append(editor, fileManager, separator)
        viewport.prepend(fragment)
        menu.dataset[WORKSPACE_ACTIONS_MARKER] = 'true'
        pendingPath = undefined
        clearTimeout(pendingTimer)
        return true
      }

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue
            if (node.getAttribute('role') === 'menu' && injectActions(node)) return
            for (const menu of node.querySelectorAll('[role="menu"]')) {
              if (injectActions(menu)) return
            }
          }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })

      const captureWorkspaceMenu = (event) => {
        if (!(event.target instanceof Element)) return
        const button = event.target.closest('button')
        const row = button?.closest('[role="treeitem"][aria-expanded]')
        if (button === null || row === null) return
        const buttons = Array.from(row.querySelectorAll('button'))
        if (buttons.length < 2 || buttons[0] !== button) return
        const rows = workspaceRows()
        const index = rows.indexOf(row)
        const workspace = index < 0 ? undefined : workspaces.list.getSnapshot().items[index]
        if (typeof workspace?.path !== 'string') return
        pendingPath = workspace.path
        pendingAt = performance.now()
        clearTimeout(pendingTimer)
        pendingTimer = setTimeout(() => {
          pendingPath = undefined
        }, 1500)
      }
      document.addEventListener('click', captureWorkspaceMenu, true)

      return () => {
        clearTimeout(pendingTimer)
        observer.disconnect()
        document.removeEventListener('click', captureWorkspaceMenu, true)
      }
    }

    function updateButtonLabel(snapshot, t) {
      if (snapshot.state === 'available') return t('update.download', { version: snapshot.version })
      if (snapshot.state === 'downloading') return t('update.downloading', { progress: snapshot.progress })
      return t('update.restart')
    }

    function createUpdateButton(t) {
      const { createElement, useEffect, useState } = React
      return function UpdateButton() {
        const [snapshot, setSnapshot] = useState(null)

        useEffect(() => {
          let disposed = false
          bridge.getUpdateState().then(state => {
            if (!disposed && state !== null) setSnapshot(state)
          }).catch(() => {})
          const unsubscribe = bridge.onUpdateState(state => {
            if (!disposed && state !== null) setSnapshot(state)
          })
          return () => {
            disposed = true
            unsubscribe()
          }
        }, [])

        if (snapshot === null || snapshot.supported !== true) return null
        const visible = snapshot.state === 'available'
          || snapshot.state === 'downloading'
          || snapshot.state === 'downloaded'
        if (!visible) return null

        const enabled = snapshot.state !== 'downloading'
        return createElement('button', {
          type: 'button',
          className: 'dshDesktopUpdateButton',
          disabled: !enabled,
          onClick: enabled ? () => { void bridge.activateUpdate().catch(() => {}) } : undefined,
        }, updateButtonLabel(snapshot, t))
      }
    }

    function installUpdateButton(ctx, t) {
      if (typeof bridge?.getUpdateState !== 'function'
        || typeof bridge?.activateUpdate !== 'function'
        || typeof bridge?.onUpdateState !== 'function') return () => {}

      const UpdateButton = createUpdateButton(t)
      const dispose = ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-desktop-update',
        order: 0,
      }, UpdateButton))
      return typeof dispose === 'function' ? dispose : () => {}
    }

    function apply(ctx) {
      if (bridge === undefined
        || typeof bridge.openPath !== 'function'
        || typeof bridge.publishWorkspaceContext !== 'function') return

      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-desktop: browser dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(installStyle, 'dsh-desktop: native action styles')

      // The header utility slot is the official additive seat; the update
      // button lands there. The Workspace ellipsis menu has no child slot, so
      // that adapter keeps its MutationObserver portal below.
      ctx.effect(() => installUpdateButton(ctx, t), 'dsh-desktop: update button')
      ctx.effect(() => installWorkspaceMenuActions(ctx.workspaces, t), 'dsh-desktop: workspace menu actions')

      ctx.effect(() => {
        const workspaces = ctx.workspaces
        const sessions = ctx.sessions
        const originalOpenPath = workspaces.openPath
        const hadOwnOpenPath = Object.hasOwn(workspaces, 'openPath')

        const openPath = async (path) => {
          let result
          try {
            result = await bridge.openPath(path, 'auto')
          } catch (error) {
            console.warn('DSH Desktop path bridge failed; falling back to the Harness opener.', error)
            return originalOpenPath.call(workspaces, path)
          }
          if (result?.ok !== true) throw new Error(result?.error ?? 'Desktop path open failed')
        }

        const publish = () => {
          const sessionState = sessions.list.getSnapshot()
          const workspaceState = workspaces.list.getSnapshot()
          const currentPath = sessionState.current === undefined
            ? undefined
            : sessionState.byId[sessionState.current]?.cwd
          const recentPath = workspaceState.recentWorkspaceId === undefined
            ? undefined
            : workspaceState.items.find(workspace => workspace.workspaceId === workspaceState.recentWorkspaceId)?.path
          const active = currentPath ?? recentPath
          bridge.publishWorkspaceContext({
            active,
            roots: workspaceState.items.map(workspace => workspace.path),
          })
        }

        workspaces.openPath = openPath
        const unsubscribeSessions = sessions.list.subscribe(publish)
        const unsubscribeWorkspaces = workspaces.list.subscribe(publish)
        publish()

        return () => {
          unsubscribeSessions()
          unsubscribeWorkspaces()
          if (workspaces.openPath === openPath) {
            if (hadOwnOpenPath) workspaces.openPath = originalOpenPath
            else delete workspaces.openPath
          }
        }
      }, 'dsh-desktop: native path adapter')
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
