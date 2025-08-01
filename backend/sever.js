// server.js
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { createCreateMetadataAccountV3Instruction, PROGRAM_ID: METAPLEX_PROGRAM_ID } = require('@metaplex-foundation/mpl-token-metadata');
const bs58 = require('bs58'); // Để giải mã private key từ base58

// Cấu hình Express App
const app = express();
const port = process.env.PORT || 3001; // Cổng cho backend

// Sử dụng CORS để cho phép frontend truy cập
app.use(cors({
    origin: 'http://localhost:3000', // Thay thế bằng địa chỉ frontend của bạn nếu khác
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use(express.json()); // Cho phép Express đọc JSON trong body của request

// Cấu hình kết nối Solana
// Sử dụng Devnet để thử nghiệm. Trong production, bạn sẽ dùng 'mainnet-beta'.
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Private Key của ví sẽ dùng để mint NFT.
// LƯU Ý QUAN TRỌNG: Trong môi trường production, KHÔNG NÊN lưu private key trực tiếp trong code.
// Hãy sử dụng biến môi trường (environment variables) và các giải pháp quản lý bí mật an toàn.
// Ví dụ này sử dụng một private key giả định. Bạn cần thay thế bằng private key của ví bạn (dạng base58 hoặc Uint8Array).
// Để lấy private key dạng base58 từ Phantom: Settings -> Export Private Key.
// Sau đó chuyển đổi nó sang Uint8Array.
// Ví dụ: const MINTER_SECRET_KEY = bs58.decode('YOUR_PHANTOM_PRIVATE_KEY_IN_BASE58');
// const MINTER_KEYPAIR = Keypair.fromSecretKey(MINTER_SECRET_KEY);
const MINTER_KEYPAIR = Keypair.generate(); // Dùng Keypair ngẫu nhiên cho demo, KHÔNG DÙNG TRONG THỰC TẾ!
console.log('Minter Public Key (DEMO):', MINTER_KEYPAIR.publicKey.toBase58());
console.log('Minter Secret Key (DEMO - KHÔNG CHIA SẺ):', bs58.encode(MINTER_KEYPAIR.secretKey));
// Đảm bảo ví này có đủ SOL trên Devnet để trả phí giao dịch.
// Bạn có thể yêu cầu SOL từ faucet: https://solana-labs.github.io/solana-web3.js/modules.html#requestAirdrop

// --- API Endpoint: Đọc Metadata NFT ---
// GET /api/nft/metadata?mintAddress=YOUR_NFT_MINT_ADDRESS
app.get('/api/nft/metadata', async (req, res) => {
    const { mintAddress } = req.query;

    if (!mintAddress) {
        return res.status(400).json({ error: 'Vui lòng cung cấp địa chỉ Mint NFT.' });
    }

    try {
        const nftMintPublicKey = new PublicKey(mintAddress);

        // Tính toán địa chỉ Metadata Account (PDA)
        const [metadataAccountPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("metadata"),
                METAPLEX_PROGRAM_ID.toBuffer(),
                nftMintPublicKey.toBuffer(),
            ],
            METAPLEX_PROGRAM_ID
        );

        // Lấy thông tin tài khoản Metadata
        const metadataAccountInfo = await connection.getAccountInfo(metadataAccountPDA);

        if (!metadataAccountInfo) {
            return res.status(404).json({ error: 'Không tìm thấy Metadata Account cho NFT này.' });
        }

        // Giải mã dữ liệu Metadata
        // Đây là nơi chúng ta cần Metaplex JS SDK để giải mã dữ liệu thô.
        // Trong môi trường Node.js, chúng ta có thể import và sử dụng nó.
        // Lưu ý: mpl-token-metadata không có hàm giải mã trực tiếp từ getAccountInfo.data
        // mà thường bạn sẽ dùng @metaplex-foundation/js để fetch NFT object.
        // Để đơn giản hóa cho ví dụ này, chúng ta sẽ mô phỏng việc lấy URI và fetch JSON.
        // Trong thực tế, bạn sẽ dùng:
        // const { nft } = await metaplex.nfts().findByMint({ mintAddress: nftMintPublicKey });
        // const metadataUri = nft.uri;

        // --- MÔ PHỎNG VIỆC GIẢI MÃ VÀ LẤY URI ---
        // Để thực sự giải mã dữ liệu thô của Metaplex, bạn cần một thư viện
        // như @metaplex-foundation/js hoặc @metaplex-foundation/mpl-token-metadata
        // và các trình phân tích cú pháp dữ liệu.
        // Vì không thể import trực tiếp các trình phân tích cú pháp phức tạp trong ví dụ này,
        // chúng ta sẽ giả định một URI metadata hợp lệ.
        // Trong môi trường thực tế, bạn sẽ giải mã `metadataAccountInfo.data` để lấy URI.
        const mockMetadataUri = `https://arweave.net/YOUR_ARWEAVE_HASH_FOR_METADATA`; // Thay thế bằng URI thật của NFT
        // Ví dụ một URI metadata thật: https://arweave.net/e_g7m_j0_a_b_c_d_e_f_g_h_i_j_k_l_m_n_o_p_q_r_s_t_u_v_w_x_y_z

        // Fetch metadata JSON từ URI
        const response = await fetch(mockMetadataUri);
        if (!response.ok) {
            throw new Error(`Không thể tải metadata từ ${mockMetadataUri}: ${response.statusText}`);
        }
        const metadataJson = await response.json();

        res.json({
            name: metadataJson.name,
            description: metadataJson.description,
            image: metadataJson.image,
            attributes: metadataJson.attributes,
            // Thêm các trường khác từ metadata JSON nếu cần
        });

    } catch (error) {
        console.error('Lỗi khi đọc metadata NFT:', error);
        res.status(500).json({ error: 'Không thể đọc metadata NFT.', details: error.message });
    }
});

// --- API Endpoint: Mint NFT ---
// POST /api/nft/mint
// Body: { recipientPublicKey: "...", name: "...", symbol: "...", uri: "..." }
app.post('/api/nft/mint', async (req, res) => {
    const { recipientPublicKey, name, symbol, uri } = req.body;

    if (!recipientPublicKey || !name || !symbol || !uri) {
        return res.status(400).json({ error: 'Vui lòng cung cấp recipientPublicKey, name, symbol, và uri.' });
    }

    try {
        const recipient = new PublicKey(recipientPublicKey);

        // 1. Tạo Mint Account mới cho NFT
        const mint = await createMint(
            connection,
            MINTER_KEYPAIR, // Người mint (phải là signer)
            MINTER_KEYPAIR.publicKey, // Authority để mint (có thể là một địa chỉ khác)
            null, // Freeze authority (null nếu không muốn đóng băng)
            0, // Decimals (0 cho NFT)
            TOKEN_PROGRAM_ID
        );

        console.log(`Đã tạo Mint Account: ${mint.toBase58()}`);

        // 2. Lấy hoặc tạo Associated Token Account (ATA) cho người nhận
        const recipientATA = await getOrCreateAssociatedTokenAccount(
            connection,
            MINTER_KEYPAIR, // Người trả phí giao dịch
            mint, // Mint Account của NFT
            recipient, // Người nhận
            true, // Allow owner off curve (true nếu recipient là PDA)
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        console.log(`Đã tạo/tìm thấy Recipient ATA: ${recipientATA.address.toBase58()}`);

        // 3. Mint 1 token vào ATA của người nhận
        await mintTo(
            connection,
            MINTER_KEYPAIR, // Người trả phí giao dịch
            mint, // Mint Account của NFT
            recipientATA.address, // Tài khoản nhận token
            MINTER_KEYPAIR.publicKey, // Authority để mint
            1, // Số lượng (1 cho NFT)
            [], // Signers (nếu mint authority không phải MINTER_KEYPAIR)
            undefined, // Program ID
            TOKEN_PROGRAM_ID
        );

        console.log(`Đã mint 1 token vào ATA của người nhận.`);

        // 4. Tạo Metadata Account cho NFT
        const [metadataAccountPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("metadata"),
                METAPLEX_PROGRAM_ID.toBuffer(),
                mint.toBuffer(),
            ],
            METAPLEX_PROGRAM_ID
        );

        const createMetadataInstruction = createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataAccountPDA,
                mint: mint,
                mintAuthority: MINTER_KEYPAIR.publicKey,
                payer: MINTER_KEYPAIR.publicKey,
                updateAuthority: MINTER_KEYPAIR.publicKey, // Có thể đặt là MINTER_KEYPAIR.publicKey hoặc một địa chỉ khác
                systemProgram: solanaWeb3.SystemProgram.programId,
                rent: solanaWeb3.SYSVAR_RENT_PUBKEY,
            },
            {
                createMetadataAccountArgsV3: {
                    data: {
                        name: name,
                        symbol: symbol,
                        uri: uri, // URI trỏ đến metadata JSON trên IPFS/Arweave
                        sellerFeeBasisPoints: 0, // Tiền bản quyền (0 nếu không có)
                        creators: [{
                            address: MINTER_KEYPAIR.publicKey,
                            verified: true,
                            share: 100,
                        }],
                        collection: null, // Nếu là một phần của bộ sưu tập NFT
                        uses: null, // Nếu có thể sử dụng (ví dụ: số lần dùng)
                    },
                    isMutable: true, // Có thể thay đổi metadata sau này không
                    collectionDetails: null, // Chi tiết bộ sưu tập
                },
            }
        );

        const transaction = new Transaction().add(createMetadataInstruction);
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [MINTER_KEYPAIR] // Người ký giao dịch
        );

        console.log(`Đã tạo Metadata Account. Transaction ID: ${signature}`);

        res.status(200).json({
            message: 'NFT đã được mint thành công!',
            mintAddress: mint.toBase58(),
            transactionSignature: signature,
        });

    } catch (error) {
        console.error('Lỗi khi mint NFT:', error);
        res.status(500).json({ error: 'Không thể mint NFT.', details: error.message });
    }
});

// Khởi chạy server
app.listen(port, () => {
    console.log(`Backend server đang chạy tại http://localhost:${port}`);
});
