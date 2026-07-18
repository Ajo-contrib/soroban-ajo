// This file re-exports the proper MultiSigService from the multisig directory
// The implementation was moved to the multisig subdirectory as part of issue #806

export { MultiSigService, multiSigService } from './multisig/MultiSigService'
export type {
  MultiSigConfig,
  MultiSigProposal,
} from './multisig/MultiSigService'
