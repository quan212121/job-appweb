const express = require('express');
const cors = require('cors');
const solanaWeb3 = require('@solana/web3.js');
const splToken = require('@solana/spl-token');
const metaplex = require('@metaplex-foundation/mpl-token-metadata');
const bs58 = require('bs58'); // Cần thiết cho các thao tác với Base58

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Khởi tạo kết nối Solana
// Sử dụng devnet để dễ dàng thử nghiệm
const connection = new solanaWeb3.Connection(
    solanaWeb3.clusterApiUrl('devnet'),
    'confirmed'
);

// Khởi tạo MINTER_KEYPAIR:
// CHO MỤC ĐÍCH DEMO: Chúng ta sẽ tạo một Keypair ngẫu nhiên mỗi khi server khởi động.
// ĐIỀU NÀY CÓ NGHĨA LÀ: Mỗi lần bạn chạy lại server, ví minter sẽ khác nhau.
// TRONG MÔI TRƯỜNG THỰC TẾ (PRODUCTION): Bạn cần sử dụng một Private Key cố định và an toàn
// (ví dụ: từ biến môi trường hoặc dịch vụ quản lý bí mật) để đảm bảo cùng một ví mint NFT.
const MINTER_KEYPAIR = solanaWeb3.Keypair.generate();

console.log(`Backend server đang chạy tại http://localhost:${PORT}`);
console.log('Minter Public Key (DEMO):', MINTER_KEYPAIR.publicKey.toBase58());
// LƯU Ý: KHÔNG BAO GIỜ LOG SECRET KEY TRONG MÔI TRƯỜNG PRODUCTION!
// Dòng dưới đây đã được loại bỏ để khắc phục lỗi 'bs58.encode is not a function'
// console.log('Minter Secret Key (DEMO - KHÔNG CHIA SẺ):', bs58.encode(MINTER_KEYPAIR.secretKey));

// Các Public Key Program ID cần thiết cho Solana
const TOKEN_PROGRAM_ID = splToken.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;
const METAPLEX_PROGRAM_ID = new solanaWeb3.PublicKey('metaqbxxUerdq28cj1RbTFW3aDGJzFsAekEapL5Qdbk');


// Endpoint để đọc Metadata NFT
app.get('/api/nft/metadata', async (req, res) => {
    try {
        const { mintAddress } = req.query;

        if (!mintAddress) {
            return res.status(400).json({ error: 'Thiếu địa chỉ mint NFT.' });
        }

        const nftMintPublicKey = new solanaWeb3.PublicKey(mintAddress);

        // Tính toán địa chỉ Metadata Account (PDA)
        const [metadataPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                METAPLEX_PROGRAM_ID.toBuffer(),
                nftMintPublicKey.toBuffer(),
            ],
            METAPLEX_PROGRAM_ID
        );

        // Lấy thông tin tài khoản metadata
        const metadataAccountInfo = await connection.getAccountInfo(metadataPDA);

        if (!metadataAccountInfo) {
            return res.status(404).json({ error: 'Không tìm thấy metadata cho NFT này.' });
        }

        // Giải mã dữ liệu metadata
        // mpl-token-metadata có thể giúp giải mã dữ liệu thô
        const metadata = metaplex.Metadata.fromAccountInfo(metadataAccountInfo.data);

        // Fetch JSON metadata từ URI
        const response = await fetch(metadata.uri);
        if (!response.ok) {
            throw new Error(`Không thể lấy metadata JSON từ URI: ${metadata.uri}`);
        }
        const jsonMetadata = await response.json();

        res.json({
            name: jsonMetadata.name,
            symbol: jsonMetadata.symbol,
            description: jsonMetadata.description,
            image: jsonMetadata.image,
            attributes: jsonMetadata.attributes,
            uri: metadata.uri,
            mintAddress: mintAddress
        });

    } catch (error) {
        console.error("Lỗi khi lấy metadata NFT:", error);
        res.status(500).json({ error: error.message || 'Lỗi server khi lấy metadata NFT.' });
    }
});


// Endpoint để Mint NFT
app.post('/api/nft/mint', async (req, res) => {
    try {
        const { recipientPublicKey, name, symbol, uri } = req.body;

        if (!recipientPublicKey || !name || !symbol || !uri) {
            return res.status(400).json({ error: 'Thiếu thông tin cần thiết để mint NFT.' });
        }

        const recipient = new solanaWeb3.PublicKey(recipientPublicKey);

        // 1. Tạo Mint Account mới cho NFT
        const mint = solanaWeb3.Keypair.generate();
        const lamports = await splToken.getMintLen(splToken.MINT_SIZE);
        const mintRent = await connection.getMinimumBalanceForRentExemption(lamports);

        const createMintAccountIx = solanaWeb3.SystemProgram.createAccount({
            fromPubkey: MINTER_KEYPAIR.publicKey,
            newAccountPubkey: mint.publicKey,
            space: splToken.MINT_SIZE,
            lamports: mintRent,
            programId: TOKEN_PROGRAM_ID,
        });

        const initMintIx = splToken.createInitializeMintInstruction(
            mint.publicKey, // Mint Account
            0, // Decimals (NFT luôn là 0 decimals)
            MINTER_KEYPAIR.publicKey, // Authority mint (có thể mint token)
            MINTER_KEYPAIR.publicKey, // Freeze authority (có thể đóng băng token)
            TOKEN_PROGRAM_ID
        );

        // 2. Lấy hoặc tạo Associated Token Account (ATA) cho người nhận
        const recipientATA = await splToken.getOrCreateAssociatedTokenAccount(
            connection,
            MINTER_KEYPAIR, // Người trả phí giao dịch
            mint.publicKey, // Mint Account của NFT
            recipient, // Người nhận
            true, // Allow owner off curve (true nếu recipient là PDA)
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // 3. Mint 1 token (NFT) vào ATA của người nhận
        const mintToIx = splToken.createMintToInstruction(
            mint.publicKey, // Mint Account
            recipientATA.address, // Destination ATA (của người nhận)
            MINTER_KEYPAIR.publicKey, // Authority mint
            1, // Số lượng token để mint (NFT luôn là 1)
            [], // Signers (nếu có thêm signer ngoài authority)
            TOKEN_PROGRAM_ID
        );

        // 4. Tạo Metadata Account cho NFT
        const [metadataPDA] = solanaWeb3.PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                METAPLEX_PROGRAM_ID.toBuffer(),
                mint.publicKey.toBuffer(),
            ],
            METAPLEX_PROGRAM_ID
        );

        const createMetadataAccountIx = metaplex.createCreateMetadataAccountV3Instruction(
            {
                metadata: metadataPDA,
                mint: mint.publicKey,
                mintAuthority: MINTER_KEYPAIR.publicKey,
                payer: MINTER_KEYPAIR.publicKey,
                updateAuthority: MINTER_KEYPAIR.publicKey,
                systemProgram: solanaWeb3.SystemProgram.programId,
                rent: solanaWeb3.SYSVAR_RENT_PUBKEY,
            },
            {
                createMetadataAccountArgsV3: {
                    data: {
                        name: name,
                        symbol: symbol,
                        uri: uri,
                        sellerFeeBasisPoints: 0, // 0% royalty
                        creators: [{
                            address: MINTER_KEYPAIR.publicKey,
                            verified: true,
                            share: 100
                        }],
                        collection: null,
                        uses: null,
                    },
                    isMutable: true, // Có thể thay đổi metadata sau này
                    collectionDetails: null,
                },
            }
        );

        // Đóng gói các lệnh vào một giao dịch
        const transaction = new solanaWeb3.Transaction().add(
            createMintAccountIx,
            initMintIx,
            createMetadataAccountIx,
            mintToIx
        );

        // Ký và gửi giao dịch
        const signature = await solanaWeb3.sendAndConfirmTransaction(
            connection,
            transaction,
            [MINTER_KEYPAIR, mint] // Ký bởi minter (trả phí) và mint (tài khoản mới)
        );

        res.status(200).json({
            message: 'NFT đã được mint thành công!',
            mintAddress: mint.publicKey.toBase58(),
            transactionSignature: signature
        });

    } catch (error) {
        console.error("Lỗi khi mint NFT:", error);
        res.status(500).json({ error: error.message || 'Lỗi server khi mint NFT.' });
    }
});

// Bắt đầu server
app.listen(PORT, () => {
    console.log(`Backend server đang chạy tại http://localhost:${PORT}`);
});
