import type { StockMoveKind } from '../../lib/stockMoves';

export function stockMovementText(reportText: (key: string, fallback: string) => string, kind: StockMoveKind): string {
  switch (kind) {
    case 'sale': return reportText('r.sold', 'Sold');
    case 'sale-reversal': return reportText('r.stock-move-sale-reversal', 'Sale undone');
    case 'return': return reportText('r.stock-move-return', 'Returned by the customer');
    case 'return-reversal': return reportText('r.stock-move-return-reversal', 'Return undone');
    case 'purchase': return reportText('r.stock-move-purchase', 'Bought');
    case 'purchase-reversal': return reportText('r.stock-move-purchase-reversal', 'Purchase undone');
    case 'purchase-return': return reportText('r.stock-move-purchase-return', 'Sent back to the vendor');
    case 'purchase-return-reversal': return reportText('r.stock-move-purchase-return-reversal', 'Sending back undone');
    case 'opening': return reportText('r.stock-move-opening', 'Opening stock');
    case 'adjustment': return reportText('r.stock-move-adjustment', 'Adjusted');
    case 'count': return reportText('r.counted-2', 'Counted');
    case 'manual-cogs': return reportText('r.stock-move-manual-cogs', 'Cost of goods sold recorded');
    case 'transfer-out': return reportText('r.stock-move-transfer-out', 'Moved out');
    case 'transfer-in': return reportText('r.stock-move-transfer-in', 'Moved in');
    case 'revaluation': return reportText('r.stock-move-revaluation', 'Revalued');
    case 'cost-repost': return reportText('r.stock-move-cost-repost', 'Cost corrected (repost)');
    case 'landed-cost': return reportText('r.stock-move-landed-cost', 'Landed cost added');
  }
}
