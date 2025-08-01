// === CẤU HÌNH ===
const express = require("express");
const cors = require("cors");
const bs58 = require("bs58");
const {
  Connection,
  clusterApiUrl,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
} = require("@solana/web3.js");
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createSetAuthorityInstruction,
  AuthorityType,
} = require("@solana/spl-token");
const {
  createCreateMetadataAccountV3Instruction,
  DataV2,
} = require("@metaplex-foundation/mpl-token-metadata");

const app = express();
app.use(cors());
app.use(express.json());

// === TẠM KHÓA: Dùng keypair từ devnet (test only) ===
const secretKey = Uint8Array.from([
  // 🔒 Thay bằng private key thật (64 byte) cho production!
  // Có thể export từ Sollet/Phantom hoặc tạo mới bằng `Keypair.generate().secretKey`
  // Ví dụ: `solana-keygen new --outfile my-keypair.json`
  // => Đọc bằng fs.readFileSync('my-keypair.json')
  // Đây là ví test có SOL trên devnet
  88, 27, 70, 223, 18, 23, 134, 12, 232, 21, 144, 47, 122, 143, 51, 1,
  47, 14, 207, 131, 75, 169, 65, 83, 29, 113, 152, 115, 248, 201, 187, 60,
  38, 184, 63, 250, 190, 156, 25, 178, 231, 114, 137, 148, 118, 162, 80, 142,
  73, 212, 66, 83, 111, 170, 213, 12, 143, 243, 49, 192, 244, 228, 183, 242
]);
const payer = Keypair.fromSecretKey(secretKey);

// === KẾT NỐI SOLANA ===
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// === METADATA PROGRAM ID ===
const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbTFW3aDGJzFsAekEapL5Qdbk"
);

// === MINT NFT ===
app.post("/mint-nft", async (req, res) => {
  try {
    const { name, symbol, uri, recipient } = req.body;

    if (!name || !symbol || !uri || !recipient) {
      return res.status(400).json({ error: "Thiếu thông tin yêu cầu." });
    }

    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      0 // 0 decimal => NFT
    );

    const recipientPublicKey = new PublicKey(recipient);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      recipientPublicKey
    );

    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      payer.publicKey,
      1
    );

    // Khoá mint authority lại để biến thành NFT (không thể mint thêm)
    const revokeMintAuthIx = createSetAuthorityInstruction(
      mint,
      payer.publicKey,
      AuthorityType.MintTokens,
      null
    );

    // Metadata Account (PDA)
    const [metadataPDA] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METAPLEX_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METAPLEX_PROGRAM_ID
    );

    const metadata = {
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: 1000, // 10% royalty
      creators: null,
      collection: null,
      uses: null,
    };

    const metadataIx = createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPDA,
        mint,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: metadata,
          isMutable: true,
          collectionDetails: null,
        },
      }
    );

    const tx = new Transaction().add(
      metadataIx,
      revokeMintAuthIx // Gắn sau để đảm bảo đã tạo metadata
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);

    res.json({
      message: "Đã mint NFT thành công!",
      mint: mint.toBase58(),
      explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    });
  } catch (error) {
    console.error("Lỗi khi mint NFT:", error);
    res.status(500).json({ error: error.message || "Lỗi server khi mint NFT." });
  }
});

// === KHỞI ĐỘNG SERVER ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend NFT server đang chạy tại http://localhost:${PORT}`);
});
