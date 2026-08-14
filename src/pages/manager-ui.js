(() => {
  const query = new URLSearchParams(location.search)
  const zh = query.get('lang') === 'zh'

  function setFeedback(element, message = '', kind = 'info') {
    element.textContent = message
    element.dataset.kind = kind
    element.dataset.visible = String(message !== '')
  }

  function errorText(result, fallback) {
    const message = typeof result?.error === 'string' && result.error.trim() !== '' ? result.error.trim() : fallback
    return message.length > 1800 ? `…${message.slice(-1800)}` : message
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag)
    element.className = className
    element.textContent = value
    return element
  }

  function actionButton(label, className, handler) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = className
    button.textContent = label
    button.addEventListener('click', handler)
    return button
  }

  function toggleButton(checked, label, handler) {
    const toggle = actionButton('', 'switch', handler)
    toggle.setAttribute('role', 'switch')
    toggle.setAttribute('aria-checked', String(checked))
    toggle.setAttribute('aria-label', label)
    return toggle
  }

  window.dshManagerUi = Object.freeze({ actionButton, errorText, setFeedback, textElement, toggleButton, zh })
})()
