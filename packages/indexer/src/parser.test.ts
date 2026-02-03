import { test, expect, describe, spyOn } from "bun:test";
import { parseTransaction } from "./parser";
import type { TransactionPayload } from "./types/node-events";

// Suppress expected error logs in tests
const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

describe("parseTransaction", () => {
  test("decodes token_transfer from raw_tx", async () => {
    // Real mainnet token transfer transaction
    const tx: TransactionPayload = {
      txid: "0x44fcbeb8a54540234eb2885b64b35b30112b6aa75cff10bb78e7ebf52adf49b7",
      raw_tx:
        "0x00000000010400f2bba6df751755ab9ac1df8b387d981cfe265cdf000000000023b83c00000000000000b4000105c7d1e497ff1e980f6504947cd9f079f793041009c69179357883ec13c2b7661e541151591a4ededf6b0801d1a01ee32333420459d6029788001ceded4c5164030200000000000516fbd9a1702f4ecc44fc01f1894c72fcbb23a53ce8000000000000000100000000000000000000000000000000000000000000000000000000000000000000",
      status: "success",
      tx_index: 0,
    };

    const result = await parseTransaction(tx, 100);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("token_transfer");
    expect(result!.sender).toBe("SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2");
    expect(result!.tx_id).toBe(tx.txid);
    expect(result!.block_height).toBe(100);
  });

  test("returns null for malformed tx without txid", async () => {
    const tx = {
      raw_tx: "0x00",
      status: "success",
      tx_index: 0,
    } as unknown as TransactionPayload;

    const result = await parseTransaction(tx, 100);

    expect(result).toBeNull();
  });

  test("falls back to unknown when raw_tx is invalid", async () => {
    const tx: TransactionPayload = {
      txid: "0xabc123",
      raw_tx: "0xinvalid",
      status: "success",
      tx_index: 0,
    };

    const result = await parseTransaction(tx, 100);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("unknown");
    expect(result!.sender).toBe("unknown");
  });

  test("uses payload tx_type and sender_address as fallback when API unavailable", async () => {
    // When raw_tx decode fails and API lookup fails, falls back to unknown
    // The payload values (tx_type, sender_address) are used as fallback after API lookup
    // In tests without network, API returns null, so we get unknown
    const tx = {
      txid: "0xabc123",
      raw_tx: "0xinvalid",
      tx_type: "token_transfer",
      sender_address: "SP123456",
      status: "success",
      tx_index: 0,
    } as unknown as TransactionPayload;

    const result = await parseTransaction(tx, 100);

    expect(result).not.toBeNull();
    // API fetch fails in test environment, so we fall back to payload values
    expect(result!.type).toBe("token_transfer");
    expect(result!.sender).toBe("SP123456");
  });

  test("decodes contract_call from raw_tx", async () => {
    // Real mainnet contract_call transaction
    const tx: TransactionPayload = {
      txid: "0x4b2a9691397f8ba0288af0956acf606273d77bc96e4744e47820b171570cf602",
      raw_tx:
        "0x000000000104006200dacf92f6eb9a9479f1465db2ccc68744d1b2000000000000006300000000002dc6c0000070ff05738e61820e191b6baa9e70f3419b4269585bc811a3328d502a4058a6d030e0afaa9f7acb2b6d0446652d6affa676823b7a7fa176928a4c051ba2dae6b80301000000000216fcbf017122aac05c65bacd6684c37a4837edfb6b06676c2d617069046f70656e0000000806167c5f674a8fd08efa61dd9b11121e046dd2c8927304777374780616fc2fe628b1da502c1b5eb3d08727ee6022503b5a0c746f6b656e2d61657573646303010000000000000000000000016af2989b01000000000000000000000000000000050100000000000000000000000000049510010000000000000000000000000000005a0c000000030a6964656e7469666965720200000020ec7a775f46379b5e943c3526b1c8d54cd49749176b0b98e02dde68d1bd335c17076d657373616765020000051f504e41550100000003b801000000040d02cde35248a184e74c4e9f5bbb515ca5b6cb6e61ea4250de5c7414aa061ee8cce204a1159559583b616b161122648e58fbd89a74babdc361ac2654f8e10cb4dc0000032c5773dd30899267ed203a0ef7a53038cc4eafeeda056b66e3b1deeddaf5b17402271db754de1a604450311b478a7e6df2497f922ffae28f317965ea6b9573e500046021dd76923a27b79854f52bd917af717708effb8c51ec78f486f1253663202b53b80bc7b3a50f5b32bbba3e22bc752eb7fae8fe25f9d66bf86131164d7e617c0106a6a7b432b8e65609938d3f8e832d7ea6984c10d1b7ea26de65b0a7bf19ce54812ec1747c6b0658d21717d84472e8801251035cc1bd3225ed7743ab6b21af89c60108f4428c1d31bfc190ddd75a9f2e7e34cab9225ccea7d54b4918a8264b5302deaa6318f1f3ad63966a2c2cc6aa2467af1a61bc21d948bbf95af28566997bd8cb27000aacfcbb922e0f6f75279c6cabae12f63d452699e5172eb355c6814547a12b75556efcf14f4c66aea39b38b600a1daa3b3030583ebd954c2443cfcb5ec3d627cba010b155f76113356975930fac793af411d4d60e1792a426bac100eb6904953a565fe6d809a9c593a6eb34875e5864dbb866bc30c1c8b2ef0aefec641aaef26b87501000c0b142feeeede0718df5827e2b2f80121690ff8f907ff7a990ebe45ac1adb433f1e69a1e627b775869db10df13919db3d5434147f0f6e80ce1c90385e80b89868000d9d67b2f8dda2d05f8c0c7e698e0edec6e57b03947a97d86bc509660260c965675f8c658f80d1d5ce2a549e3756a128dac00497be61c50dbd0c23716bb60c0a8b010e9faec713c619da687aa0f2de4db311aae92be836f6bfa5138927bc03f91423ef35a9ce771aaf0cc2b4db1f8666a5e87574cb0049fb6bb9ad3e103c415b81c79d010fb328fa9d6939f4d42cdf17a6e25b2e288c00b81a68494b5a01688a20679d486479845a4f89d25b44bd91227ea60abed08057fadfc858579e4a46168449d45d9c0110325356c957c69e5cb1304229938c400f986d9c33fbf4d97b12cfc4a87b4ca54909be3d399050c96b753592ecfffd90ad362b1af07644a5f41266087da78ce8a40011c144261cfe2f10d5d92956f5d9a796565a8391fae9ab4838ee757fb4226e0a4b42fcb4df2055a724606e6947b40790e9e2bb691a7efc7c48d79d958e965b19f700697951ff00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa71000000000b0574af0141555756000000000010131d41000027102b8a96875c64abe7d792b1dfae31e2e06ab1876f01005500ec7a775f46379b5e943c3526b1c8d54cd49749176b0b98e02dde68d1bd335c170000000001ca3a91000000000000b85bfffffff800000000697951ff00000000697951fe0000000001cc63fa000000000000a1880daa01e1e42205e0f73624d7d5b1cf224281578ea8013a476da0150c246dfcf6fbc96b5c788934c9159ba97e7eff35a99660caade9db9d2ec40cc64029851ef9e4974aeab998bbcff282134312d3667af3e9802027f9ccac59ce677f8a30cf299b0525b1d4f37200141d6622d599efd93b857631345112ec1a74eccf222900a9f9fdf1af3607ea4d496e3401621d38ea5600f91794b3c296b2dea4de25f3e077a8e5224e543f58be01b87a3cae01214369bdc2e9b35fac3c6c5ad5bcb9f8b38eb76dd3ebc16c449041406ad0e445d71eccdc87e54e61590172a3883f2bbccfa6642ede04b93835394aa12c2e5b3542d0449fc6439387672f1963c5b47eb3bc7bc97a7d22e3066f7261636c650616fcbf017122aac05c65bacd6684c37a4837edfb6b09676c2d6f7261636c65",
      status: "success",
      tx_index: 0,
    };

    const result = await parseTransaction(tx, 100);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("contract_call");
    expect(result!.sender).toBe("SP1H01PPFJBVEQ6MMF7RMCQDJSK38EH6HP8E7M10M");
    expect(result!.contract_id).toBe("SP3YBY0BH4ANC0Q35QB6PD163F943FVFVDFM1SH7S.gl-api");
    expect(result!.function_name).toBe("open");
  });
});
