import React, { useCallback, useEffect, useState } from 'react'
import { Descendant, Editor, Node, Operation, Scrubber, Selection } from 'slate'
import { EDITOR_TO_ON_CHANGE } from 'slate-dom'
import { FocusedContext } from '../hooks/use-focused'
import { useIsomorphicLayoutEffect } from '../hooks/use-isomorphic-layout-effect'
import {
  useSelectorContext,
  SlateSelectorContext,
} from '../hooks/use-slate-selector'
import { EditorContext } from '../hooks/use-slate-static'
import { ReactEditor } from '../plugin/react-editor'
import { REACT_MAJOR_VERSION } from '../utils/environment'

/**
 * A wrapper around the provider to handle `onChange` events, because the editor
 * is a mutable singleton so it won't ever register as "changed" otherwise.
 */

export const Slate = (props: {
  editor: ReactEditor
  initialValue: Descendant[]
  children: React.ReactNode
  onChange?: (value: Descendant[]) => void
  onSelectionChange?: (selection: Selection) => void
  onValueChange?: (value: Descendant[]) => void
  dataBatchConfig?: {
    enabled: boolean
    initialBatch: number
    batchSize: number
    interval: number
  }
  onChunkRendered?: (renderedCount: number, totalCount: number) => void
  onAllChunksRendered?: () => void
}) => {
  const {
    editor,
    children,
    onChange,
    onSelectionChange,
    onValueChange,
    initialValue,
    dataBatchConfig,
    onChunkRendered,
    onAllChunksRendered,
    ...rest
  } = props

  // get callbacks and config from editor instance, prioritize props config
  const chunkRenderedCallback = onChunkRendered || editor.onChunkRendered
  const allChunksRenderedCallback =
    onAllChunksRendered || editor.onAllChunksRendered
  const batchConfig = dataBatchConfig || editor.dataBatchConfig

  const loadingRef = React.useRef(false)
  const allChunksRenderedRef = React.useRef(false)

  // Run once on first mount, but before `useEffect` or render
  React.useState(() => {
    if (!Node.isNodeList(initialValue)) {
      throw new Error(
        `[Slate] initialValue is invalid! Expected a list of elements but got: ${Scrubber.stringify(
          initialValue
        )}`
      )
    }

    if (!Editor.isEditor(editor)) {
      throw new Error(
        `[Slate] editor is invalid! You passed: ${Scrubber.stringify(editor)}`
      )
    }

    // data layer batch loading
    if (batchConfig?.enabled) {
      // batch mode: set only part of the data first
      const initialBatch = Math.min(
        batchConfig.initialBatch,
        initialValue.length
      )
      editor.children = initialValue.slice(0, initialBatch)
      // reset completed state, because the data may have changed
      allChunksRenderedRef.current = false
    } else {
      // full rendering, set complete data
      editor.children = initialValue
      // in full mode, no need to trigger batch completion callback
      allChunksRenderedRef.current = true
    }

    Object.assign(editor, rest)
  })

  const { selectorContext, onChange: handleSelectorChange } =
    useSelectorContext()

  const onContextChange = useCallback(
    (options?: { operation?: Operation }) => {
      if (onChange) {
        onChange(editor.children)
      }

      switch (options?.operation?.type) {
        case 'set_selection':
          onSelectionChange?.(editor.selection)
          break
        default:
          onValueChange?.(editor.children)
      }

      handleSelectorChange()
    },
    [editor, handleSelectorChange, onChange, onSelectionChange, onValueChange]
  )

  useEffect(() => {
    EDITOR_TO_ON_CHANGE.set(editor, onContextChange)

    return () => {
      EDITOR_TO_ON_CHANGE.set(editor, () => {})
    }
  }, [editor, onContextChange])

  const [isFocused, setIsFocused] = useState(ReactEditor.isFocused(editor))

  // data layer batch loading state
  const [currentDataCount, setCurrentDataCount] = useState(() => {
    if (batchConfig?.enabled) {
      return Math.min(batchConfig.initialBatch, initialValue.length)
    }
    return initialValue.length
  })

  // data layer batch loading
  useEffect(() => {
    if (!batchConfig?.enabled || currentDataCount >= initialValue.length) {
      if (
        currentDataCount >= initialValue.length &&
        batchConfig?.enabled &&
        !allChunksRenderedRef.current
      ) {
        allChunksRenderedRef.current = true
        allChunksRenderedCallback?.()
      }
      return
    }

    const loadNextBatch = () => {
      if (loadingRef.current) return

      const nextCount = Math.min(
        currentDataCount + batchConfig.batchSize,
        initialValue.length
      )

      if (nextCount > currentDataCount) {
        loadingRef.current = true

        editor.children = initialValue.slice(0, nextCount)

        setCurrentDataCount(nextCount)
        chunkRenderedCallback?.(nextCount, initialValue.length)

        // trigger editor re-render
        handleSelectorChange()

        loadingRef.current = false
      }
    }

    let idleId: number
    let timeoutId: NodeJS.Timeout

    const scheduleNextBatch = () => {
      if (batchConfig.interval > 0) {
        if (typeof requestIdleCallback !== 'undefined') {
          idleId = requestIdleCallback(
            deadline => {
              // if there is still idle time, execute immediately
              if (deadline.timeRemaining() > 0) {
                loadNextBatch()
                // if there is still data to load, schedule the next batch
                if (currentDataCount < initialValue.length) {
                  scheduleNextBatch()
                }
              } else {
                // if there is no idle time, delay execution
                timeoutId = setTimeout(() => {
                  loadNextBatch()
                  if (currentDataCount < initialValue.length) {
                    scheduleNextBatch()
                  }
                }, batchConfig.interval)
              }
            },
            { timeout: batchConfig.interval }
          )
        } else {
          // browser does not support requestIdleCallback, use setTimeout as fallback
          timeoutId = setTimeout(() => {
            loadNextBatch()
            if (currentDataCount < initialValue.length) {
              scheduleNextBatch()
            }
          }, batchConfig.interval)
        }
      } else {
        // if there is no interval, execute immediately
        loadNextBatch()
      }
    }

    // start scheduling
    scheduleNextBatch()

    return () => {
      if (idleId) cancelIdleCallback(idleId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [
    batchConfig,
    currentDataCount,
    initialValue,
    chunkRenderedCallback,
    allChunksRenderedCallback,
    editor,
    handleSelectorChange,
  ])

  useEffect(() => {
    setIsFocused(ReactEditor.isFocused(editor))
  }, [editor])

  useIsomorphicLayoutEffect(() => {
    const fn = () => setIsFocused(ReactEditor.isFocused(editor))
    if (REACT_MAJOR_VERSION >= 17) {
      // In React >= 17 onFocus and onBlur listen to the focusin and focusout events during the bubbling phase.
      // Therefore in order for <Editable />'s handlers to run first, which is necessary for ReactEditor.isFocused(editor)
      // to return the correct value, we have to listen to the focusin and focusout events without useCapture here.
      document.addEventListener('focusin', fn)
      document.addEventListener('focusout', fn)
      return () => {
        document.removeEventListener('focusin', fn)
        document.removeEventListener('focusout', fn)
      }
    } else {
      document.addEventListener('focus', fn, true)
      document.addEventListener('blur', fn, true)
      return () => {
        document.removeEventListener('focus', fn, true)
        document.removeEventListener('blur', fn, true)
      }
    }
  }, [])

  return (
    <SlateSelectorContext.Provider value={selectorContext}>
      <EditorContext.Provider value={editor}>
        <FocusedContext.Provider value={isFocused}>
          {children}
        </FocusedContext.Provider>
      </EditorContext.Provider>
    </SlateSelectorContext.Provider>
  )
}
