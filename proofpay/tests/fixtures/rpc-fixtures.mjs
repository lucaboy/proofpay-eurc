import { EURC_MINT, base58Encode } from "../../src/core.mjs";

export const RECIPIENT = base58Encode(Buffer.alloc(32, 3));
export const OTHER_RECIPIENT = base58Encode(Buffer.alloc(32, 4));
export const WRONG_MINT = base58Encode(Buffer.alloc(32, 5));
// Independent vector generated with @solana/spl-token 0.4.8.
export const TOKEN_ACCOUNT =
  "7pXsBCMbAPP3G325j7x3qiqYeXZBq7b7WENFDztHeGUv";
export const SIGNATURE = base58Encode(Buffer.alloc(64, 9));
export const OTHER_SIGNATURE = base58Encode(Buffer.alloc(64, 10));

const SOURCE_TOKEN_ACCOUNT = base58Encode(Buffer.alloc(32, 8));
const AUTHORITY = base58Encode(Buffer.alloc(32, 12));
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SPL_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

function transferCheckedData(amount) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(BigInt(amount), 1);
  data[9] = 6;
  return base58Encode(data);
}

export function rpcFixture(
  invoice,
  {
    recipient = invoice.recipient,
    mint = invoice.mint,
    preAmount = "5000000",
    delta = invoice.amountAtomic,
    memo = invoice.memo,
    metaErr = null,
    confirmationStatus = "finalized",
    signature = SIGNATURE,
    transactionSignature = signature,
    transactionNull = false,
    reference = invoice.reference,
    duplicateReference = false,
    referenceOnTransfer = true,
    extraTransferAccount = false,
    omitTransfer = false,
    transferBeforeMemo = false,
    blockTime = Math.floor(Date.parse(invoice.createdAt) / 1000) + 60,
    signatureBlockTime = blockTime,
    omitSignatureBlockTime = false,
    previousInstructionData = null,
    destinationTokenAccount = TOKEN_ACCOUNT,
  } = {},
) {
  const postAmount = (BigInt(preAmount) + BigInt(delta)).toString();
  const calls = [];
  const rpcCall = async (rpcUrl, method, params) => {
    calls.push({ rpcUrl, method, params });
    if (method === "getSignaturesForAddress") {
      const historyEntry = {
        signature,
        slot: 123456,
        err: metaErr,
        memo: null,
        blockTime: signatureBlockTime,
        confirmationStatus,
      };
      if (omitSignatureBlockTime) {
        delete historyEntry.blockTime;
      }
      return [historyEntry];
    }
    if (method === "getTransaction") {
      if (transactionNull) {
        return null;
      }
      const accountKeys = [
        AUTHORITY,
        destinationTokenAccount,
        SOURCE_TOKEN_ACCOUNT,
        reference,
        mint,
        MEMO_PROGRAM_ID,
        SPL_TOKEN_PROGRAM_ID,
        SYSTEM_PROGRAM_ID,
        ...(duplicateReference ? [reference] : []),
      ];
      const memoInstruction = {
        programIdIndex: 5,
        accounts: [],
        data: base58Encode(Buffer.from(memo, "utf8")),
      };
      const transferAccounts = [
        2,
        4,
        1,
        0,
        ...(referenceOnTransfer ? [3] : []),
        ...(extraTransferAccount ? [5] : []),
      ];
      const transferInstruction = {
        programIdIndex: 6,
        accounts: transferAccounts,
        data: transferCheckedData(delta),
      };
      return {
        slot: 123456,
        blockTime,
        transaction: {
          signatures: [transactionSignature],
          message: {
            header: {
              numRequiredSignatures: 1,
              numReadonlySignedAccounts: 0,
              numReadonlyUnsignedAccounts: 5 + (duplicateReference ? 1 : 0),
            },
            accountKeys,
            recentBlockhash: base58Encode(Buffer.alloc(32, 13)),
            instructions: (() => {
              if (omitTransfer) {
                return [memoInstruction];
              }
              const paymentInstructions = transferBeforeMemo
                ? [transferInstruction, memoInstruction]
                : [memoInstruction, transferInstruction];
              return previousInstructionData === null
                ? paymentInstructions
                : [
                    {
                      programIdIndex: 0,
                      accounts: [],
                      data: previousInstructionData,
                    },
                    ...paymentInstructions,
                  ];
            })(),
          },
        },
        meta: {
          err: metaErr,
          preTokenBalances: [
            {
              accountIndex: 1,
              mint,
              owner: recipient,
              uiTokenAmount: {
                amount: preAmount,
                decimals: 6,
                uiAmount: Number(preAmount) / 1_000_000,
                uiAmountString: (Number(preAmount) / 1_000_000).toString(),
              },
            },
          ],
          postTokenBalances: [
            {
              accountIndex: 1,
              mint,
              owner: recipient,
              uiTokenAmount: {
                amount: postAmount,
                decimals: 6,
                uiAmount: Number(postAmount) / 1_000_000,
                uiAmountString: (Number(postAmount) / 1_000_000).toString(),
              },
            },
          ],
          innerInstructions: [],
          loadedAddresses: {
            writable: [],
            readonly: [],
          },
        },
      };
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  };
  return { rpcCall, calls };
}
