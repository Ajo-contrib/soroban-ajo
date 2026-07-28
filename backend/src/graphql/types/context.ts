import { DataLoaders } from '../dataloader'
import { AdminUser } from '../../middleware/adminAuth'

export interface GraphQLContext {
  /** Stellar public key of the authenticated caller, mirrors REST req.user.walletAddress */
  walletAddress?: string
  /** Present only when the caller's token verifies as an admin token, mirrors REST req.admin */
  admin?: AdminUser
  loaders: DataLoaders
}
