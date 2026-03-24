import { useEffect, useRef } from 'react'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  /** Footer buttons — if not provided, no footer */
  footer?: React.ReactNode
  width?: number
}

export function Modal({ open, title, onClose, children, footer, width }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className={styles.modal} style={width ? { width } : undefined}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.close} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  )
}

/* ── Confirm dialog ── */

interface ConfirmModalProps {
  open: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({ open, title, message, confirmText, cancelText, danger, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      title={title || '确认操作'}
      onClose={onCancel}
      footer={
        <>
          <button className={styles.btnCancel} onClick={onCancel}>{cancelText || '取消'}</button>
          <button className={`${styles.btnConfirm} ${danger ? styles.btnDanger : ''}`} onClick={onConfirm}>{confirmText || '确定'}</button>
        </>
      }
    >
      <p className={styles.message}>{message}</p>
    </Modal>
  )
}

/* ── Prompt dialog (single input) ── */

interface PromptModalProps {
  open: boolean
  title: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptModal({ open, title, label, placeholder, defaultValue, confirmText, onConfirm, onCancel }: PromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  function handleSubmit() {
    const val = inputRef.current?.value.trim()
    if (val) onConfirm(val)
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className={styles.btnCancel} onClick={onCancel}>取消</button>
          <button className={styles.btnConfirm} onClick={handleSubmit}>{confirmText || '确定'}</button>
        </>
      }
    >
      {label && <label className={styles.label}>{label}</label>}
      <input
        ref={inputRef}
        className={styles.input}
        placeholder={placeholder}
        defaultValue={defaultValue || ''}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        data-testid="prompt-modal-input"
      />
    </Modal>
  )
}

/* ── Alert dialog ── */

interface AlertModalProps {
  open: boolean
  title?: string
  message: string
  onClose: () => void
  type?: 'info' | 'success' | 'error'
}

export function AlertModal({ open, title, message, onClose, type }: AlertModalProps) {
  const titleText = title || (type === 'error' ? '错误' : type === 'success' ? '成功' : '提示')
  return (
    <Modal
      open={open}
      title={titleText}
      onClose={onClose}
      footer={<button className={styles.btnConfirm} onClick={onClose}>知道了</button>}
    >
      <p className={`${styles.message} ${type === 'error' ? styles.msgError : type === 'success' ? styles.msgSuccess : ''}`}>{message}</p>
    </Modal>
  )
}
