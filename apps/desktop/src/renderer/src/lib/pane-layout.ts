import type { Pane, PaneNode, PaneSplit } from '@cerebro/core'

export type Rect = { x: number; y: number; width: number; height: number }
export type PositionedPane = { pane: Pane; rect: Rect }
export type PositionedSplit = { split: PaneSplit; rect: Rect }

/** Flatten the BSP tree so splitting or closing neighbors never remounts a terminal. */
export function positionPanes(root: PaneNode): {
  panes: PositionedPane[]
  splits: PositionedSplit[]
} {
  const panes: PositionedPane[] = []
  const splits: PositionedSplit[] = []
  const visit = (node: PaneNode, rect: Rect): void => {
    if (node.type === 'pane') {
      panes.push({ pane: node, rect })
      return
    }
    splits.push({ split: node, rect })
    if (node.direction === 'right') {
      visit(node.first, { ...rect, width: rect.width * node.ratio })
      visit(node.second, {
        ...rect,
        x: rect.x + rect.width * node.ratio,
        width: rect.width * (1 - node.ratio)
      })
    } else {
      visit(node.first, { ...rect, height: rect.height * node.ratio })
      visit(node.second, {
        ...rect,
        y: rect.y + rect.height * node.ratio,
        height: rect.height * (1 - node.ratio)
      })
    }
  }
  visit(root, { x: 0, y: 0, width: 100, height: 100 })
  return { panes, splits }
}
