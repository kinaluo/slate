import { Ancestor } from 'slate'
import { DOMEditor, type DOMEditorInterface } from 'slate-dom'

/**
 * A React and DOM-specific version of the `Editor` interface.
 */

export interface ReactEditor extends DOMEditor {
  /**
   * Determines the chunk size used by the children chunking optimization. If
   * null is returned (which is the default), the chunking optimization is
   * disabled.
   */
  getChunkSize: (node: Ancestor) => number | null

  /**
   * Data batch loading configuration for large documents
   */
  dataBatchConfig?: {
    enabled: boolean
    initialBatch: number
    batchSize: number
    interval: number
  }

  /**
   * Callback function called when a chunk is rendered
   */
  onChunkRendered?: (renderedCount: number, totalCount: number) => void

  /**
   * Callback function called when all chunks are rendered
   */
  onAllChunksRendered?: () => void
}

export interface ReactEditorInterface extends DOMEditorInterface {}

// eslint-disable-next-line no-redeclare
export const ReactEditor: ReactEditorInterface = DOMEditor
