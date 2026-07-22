'use strict'

const img = document.getElementById('img')
const source = new URLSearchParams(window.location.search).get('src')

try {
  const sourceUrl = new URL(source)
  if (sourceUrl.protocol === 'file:') img.src = sourceUrl.href
} catch (_) {
  // main process가 검증한 file URL이 아니면 아무것도 표시하지 않는다.
}

let dragging = false

img.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  dragging = true
  img.classList.add('dragging')
  try { img.setPointerCapture(event.pointerId) } catch (_) {}
  window.widget.dragStart(Math.round(event.clientX), Math.round(event.clientY))
})

img.addEventListener('pointermove', () => {
  if (dragging) window.widget.dragMove()
})

function endDrag(event) {
  if (!dragging) return
  dragging = false
  img.classList.remove('dragging')
  try { img.releasePointerCapture(event.pointerId) } catch (_) {}
  window.widget.dragEnd()
}

img.addEventListener('pointerup', endDrag)
img.addEventListener('pointercancel', endDrag)

window.addEventListener('wheel', (event) => {
  event.preventDefault()
  window.widget.wheel(event.deltaY)
}, { passive: false })

window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  window.widget.contextMenu()
})
