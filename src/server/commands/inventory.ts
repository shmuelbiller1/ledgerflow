/**
 * Stock (K-13 BA-04, BF-08, EG-6, EG-7, ISS-130, W-01 W-04 W-05 W-06): the writes the inventory
 * router used to run by hand. Each one's checks move to `prepare` (read-only; the runner's
 * workspace, role and period gates run before it) and its write to a service function that takes
 * the runner's transaction, so the stock change, its entry, its history and its audit line commit
 * together or not at all. The legacy URLs stay as thin wrappers with their own wire shapes
 * (`{ status: 'ok' }` and an `error` field), not the command envelope.
 *
 * The definitions live in two modules to keep each file readable: `inventoryStock.ts` (the writes
 * that move a quantity with their entry) and `inventoryFlow.ts` (the settings and the shipments).
 */
export {
  inventoryAdjustCommand, inventoryAdjustInput, inventoryCogsCommand, inventoryCogsInput,
  inventoryCountCommand, inventoryCountInput, inventoryRevalueCommand, inventoryRevalueInput,
  type StockWriteResult,
} from './inventoryStock';
export {
  inventoryDeliverCommand, inventoryDeliverInput, inventoryLandedCostCommand, inventoryLandedCostInput,
  inventoryLandedCostUndoCommand, inventoryLandedCostUndoInput, inventoryReturnCommand, inventoryReturnInput,
  inventoryStockClosingCommand, inventoryStockClosingInput, inventoryStockPolicyCommand, inventoryStockPolicyInput,
  inventoryTransferCommand, inventoryTransferInput, inventoryUndoDeliveryCommand, inventoryUndoDeliveryInput,
} from './inventoryFlow';
