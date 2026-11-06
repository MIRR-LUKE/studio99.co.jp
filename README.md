# Studio99® — TYPE YOUR WORLD.

独立したガラスの3Dキーを入力インターフェースにした、Studio99のローカル制作版です。リポジトリは [MIRR-LUKE/studio99.co.jp](https://github.com/MIRR-LUKE/studio99.co.jp)。Webサイトの公開環境へのデプロイは行っていません。

## 起動

Node.js 22を使用。

```sh
npm ci
npm run dev
```

http://127.0.0.1:3000 を開きます。ポートを変更する場合は `npm run dev -- --port 3001`。

```sh
npm run typecheck
npm test
npm run build
npm start
```

テストにはインストール済みのGoogle Chromeを使用します。`playwright.config.ts` の `channel` を別環境に合わせて変更できます。

## 操作

Heroは紙の灰色のポスターです。中央に「world」と刻まれたガラスのキーが1個だけ浮かび、カーソルの方へわずかに傾き、押すと沈みます。キーはキーボードと同じBlenderの形と光学データ（白い光が動く結晶のガラス）を使っています。四隅の文字から About / Works / Contact へ移動します。動きを減らす設定では静止します。3Dが使えない環境では、キーの位置に「world」の文字を表示します。

キーボード、文字入力、氷のディスプレイの体験は一時停止中です（`src/components/KeyboardExperience.tsx` にそのまま保管）。

## 実装

- Next.js 16 / React 19 / React Three Fiber 9 / Three.js / Drei / TypeScript
- `src/lib/keyboard-layout.ts`: US配列、キー寸法、位置
- `src/lib/input-machine.ts`: 物理・ポインタを統合した入力状態機械
- `src/lib/commands.ts`: コマンド、prefix補完、URL
- `src/lib/motion.ts`: 個別の漂い・慣性・近接回避、全体の凝集、散開のタイミング
- `src/components/KeyboardScene.tsx`: 独立メッシュ、共有ジオメトリ、押下のばね、アトラス文字
- `src/lib/optical-transport.ts`: Blenderの光源位置、入射方向と視点による光学サンプルの選択
- `src/lib/key-response.ts`: 押下・ホバーの圧縮とねじれのばね
- `src/components/OpticalMotion.ts`: 光学合成、Blender表示変換、面光源の反射、角度依存の薄膜虹彩
- `src/components/Experience.tsx`: ポスターの枠組み（四隅の文字、見出し、円と線）とページ
- `src/components/WorldKey.tsx`: 浮かぶ world キー。ブラウザでリアルタイムに光線追跡する（形状はBlenderのキー、内部は同じ断面からの距離場、3つの屈折率、全反射、AgX）。後ろの大きな文字はDOMから描いて紙面として置き、ガラス越しに屈折して見える
- `src/lib/world-key-studio.ts`: Cyclesと同じスタジオ（Blender座標からの変換、カメラ、紙の校正値、光の移動、姿勢、断面）
- `src/lib/key-physics.ts`: 押した点に力がかかる剛体＋柔らかいゼリーのモード（つぶれ・揺れ・ねじれ・へこみ）。シェーダーの変形と同じ形の関数
- `scripts/render-world-key.py` / `scripts/package-world-key.mjs`: 平らな上面のキー形状（glb）とCyclesの静止画（JavaScriptなし・WebGLなしの表示、リアルタイム版の比較用）を書き出す（`npm run assets:world-key`、約1分）
- `src/components/KeyboardExperience.tsx`: 一時停止中のキーボードの世界（入力、IME保護、透明なHTML、氷のディスプレイ）
- `src/lib/world.ts`: URLから今いる世界を決める。押されたまま／立ち上がるキー、未知の言葉の安全なURL
- `src/components/ProjectionScreen.tsx`: Heroの闇に浮かぶ光（打った言葉、候補、⌘の一覧、署名、カーソル）。端の減光とにじみ
- `src/components/IceDisplay.tsx`: 氷のディスプレイ。Cyclesの焼き込み画像を枠に合わせて置き、ページの光と凍る演出を重ねる
- `scripts/bake-ice-display.py`: ディスプレイの見た目をCyclesで焼く（横長・縦長）。`scripts/build-ice-display-study.py` は見た目の検討用の静止画、`scripts/render-display-content.mjs` はその中身
- `src/lib/screen-paint.ts` / `src/components/useProjection.ts`: 透明なHTMLの行の位置と書体をCanvasに写し、スクリーンへ。スクロール・入力・フォーカスに追従
- `src/lib/screen-store.ts`: HTML側と3D側で共有する、スクリーンの状態
- `src/app/[...world]/page.tsx`: 直接アクセスできる、静的生成されたHTMLコンテンツ
- `src/lib/content.ts`: 仮の会社・作品原稿とメールアドレス

### コンテンツについて

ユーザーの了承に基づく仮原稿です。会社名、指定されたプロジェクト名、取得済みドメイン以外の説明文・作品ビジュアルは制作プレビューです。問い合わせ先 `hello@studio99.co.jp` の実在は未確認です。フォームはメールアプリで下書きを作り、このサイトから送信しません。公開前に確定原稿と実在する問い合わせ先へ差し替え、`layout.tsx` の `robots` を調整してください。

## BlenderとWebの光学表現

最新の単体キー参考を基に、高い台形の透明体、丸めた稜線、くぼんだ上面をBlenderで生成しています。白い照明を用い、異なる屈折率で赤・緑・青の光路を別々にレンダリングし、線形空間で合成してからAgXで表示変換します。RGBの発光キーではありません。

```sh
# 単体キーの高品質レンダーと、8サイズのGLB
"/Users/apple/Applications/Blender.app/Contents/MacOS/Blender" --background \
  --python scripts/build-optical-keycap.py -- \
  --samples 512 --portrait --spectral --export-web --output crystal-final-portrait

# 8サイズ × 左・中央・右の視点で照明結果をベイク
"/Users/apple/Applications/Blender.app/Contents/MacOS/Blender" --background \
  --python scripts/bake-keycap-lighting.py

# 実際に使用する14バリエーションの動く光学データを再生成・可逆圧縮
npm run assets:motion
```

- `assets/blender/optical-keycap-study.blend`: 単体の形状・照明・編集用材質
- `assets/blender/optical-keycaps-library.blend`: 8サイズの光学キー
- `assets/blender/baked-keycap-library.blend`: 24視点バリエーションとベイク材質
- `public/models/baked-keycaps.glb`: 実際にWebが使う立体メッシュとUV
- `public/models/optical/`: Web用の光学テクスチャ
- `assets/blender/optical-motion-study.blend`: 移動する白い面光源と内部の分光を確認する編集用シーン
- `assets/blender/optical-motion/`: 各形状・視点につき11種類の線形光学計算結果（NumPyキャッシュ）
- `public/models/motion/`: RGBM16の可逆WebPアトラス、Blender AgXの表示変換LUT、寸法と容量のmanifest
- `docs/qa/optical-motion/contact-sheet.png`: 異なる時点でのBlender光学プレビュー
- `docs/qa/crystal-final-portrait.png`: 最終のBlender単体レンダリング
- `/studies/crystal-keycap.png`: ブラウザでも確認できる同画像

単体 `.blend` の編集用RGB材質は即時確認用の近似です。納品PNGと同じ分光結果は、上記 `--spectral` コマンドで再生成してください。線形EXRは `assets/blender/spectral-passes/` に保存されます。

### Webでの表現の範囲

Webは**実際の3D形状に、固定カメラ用の光学計算結果を組み合わせた構成**です。全体を1枚の背景画像にはしていません。各キーは独立したメッシュで、raycast、押下、同時入力、Spaceでの間隔変化が動作します。

光学データは、固定の白い縁取り1種類・側面の光源6位置・下部の光源4位置を、それぞれ3屈折率、128 samples、最大16バウンスで事前計算しています。revision 4では固定ベイクから移動光源2つを除き、止まった虹色と動く光が二重になる問題を修正しました。固定7灯と移動2灯の構成です。

ブラウザでは、光源の位置・キーのワールド回転（押下時の傾きも含む）・カメラから、キーのローカル座標系で入射方向を求めます。固定ベイク視点との差は反射のhalf-vectorで近似補正し、球面上の連続したGaussian重みで6方向＋4方向の光量を補間します。最寄りの2枚を選ぶ方式は、境界で参照先が飛ぶことが判明したため廃止しました。重みは正規化して光量の過剰加算を防ぎ、時間方向の遅延フィルターも加えていません。各キーに色を回す時計はありません。同じ光・面・視点なら時間が経っても同じ色です。光源は全キーで共有し、滑らかなノイズで移動速度にむらと間を持たせています。

表面の虹彩は、Three.jsの薄膜Fresnel計算（Snell則と波長別の光路差）を使います。膜厚はキーごとに固定し、光・視点のhalf-vectorに対する角度で色が変わります。面光源への反射線と拡散布の形状からハイライトの位置を計算します。内部のプリズム分光と表面の薄膜干渉は異なる効果として実装しています。[Three.jsの材質説明](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)。最後にBlender自身から生成したAgX LUTを適用します。

最初は既存の光学静止画を表示し、アトラスを3個ずつ読み込み、GPUへの転送をフレームに分散して切り替えます。アトラスは形状・視点ごとに共有し、キーごとの動画や透過用の描画バッファは作りません。WebPは可逆圧縮で、梱包時に元PNGとの全ピクセル一致を検査します。

各キーはX/Y/Zの移動とpitch/yaw/rollの6軸すべてに、異なる速度・振れ幅・慣性を持ちます。大きな漂いと小さな方向修正を混ぜ、止まりかけて戻る間もキーごとに異なります。配列への引力でまとまりを保ち、長いキーは回転を抑えます。ホバー・押下中はそのキーの浮遊位置と角度を一時保持して押しやすくし、弾みは別のばねで動かします。近接回避は回転後の外形を考慮し、高さ方向の接触と押し戻しを連続にしています。最新のユーザー指示により、元仕様の「ほぼ静止」と「720ms自動確定」は変更しています。Enter確定後はキーごとの時間差で散開し、約1.18秒後にコンテンツを表示。Escで途中キャンセルすると配列へ戻ります。

カメラを自由回転させる用途や、大きな形状変形で光路を再計算する用途には対応しません。スマホのカメラは基準の仰角を保って近づく・引く方向に限定しています。カメラ角度・キー形状・照明を大きく変更するときはベイクも更新してください。ブラウザでCyclesと同じ多重屈折を毎フレーム実行する構成ではありません。

押下は硬めの圧縮ばねと、減衰の遅いねじればねの2成分です。約1秒の細かな余韻を残し、65msの最小押下で短いタップも取りこぼしません。ホバーは小さな一度の衝撃だけで、拡大・明るさ変更・浮き上がったままの状態はありません。最大1/120秒の積分ステップで30/60/120Hzの差を抑えています。

氷のディスプレイは常にカメラに正対し、透明なHTMLの枠（`.display-frame`）の周りに置かれるので、カメラから見た姿は形ごとに1つです。その姿を `scripts/bake-ice-display.py` がCyclesで焼き（3屈折率の分光、厚いテーパーの壁、白い面光源）、ブラウザはその画像にページの光と凍る演出を重ねます。CSSで枠の比率を変えたら焼き直してください。

形状と光学アトラスは共有し、文字は1枚のテクスチャを使います。スマホもPCと同じ14アトラス（8.39 MiB、GPU概算93.60 MiB）を共有し、品質を維持します。カメラから外れるキーは描画時にカリングされます。DPRは最大1.6。世界の中では読んでいる間は描画せず、スクロール・入力・ポインタ操作のあいだだけ描きます。タブ非表示時は止めます。`prefers-reduced-motion` では浮遊・光源移動・弾みを止め、遷移の待ち時間を省き、文字カーソルの点滅も止めます。

動く光の編集用 `.blend` は単一IORのプレビューです。Webの2光源と同じ移動式を30秒分保存しています。Webと同じ3屈折率の合成結果は `npm run assets:motion` で再生成します。光源・形状・計算条件を変える際は `assets/blender/optical-motion/Keycap_*` のキャッシュを別名で退避してから再実行してください。旧固定光のキャッシュは `00.revision3.npy` に保存しています。

`node scripts/capture-angle-response.mjs` は静止・光源だけ回転・キーだけ傾斜の比較を保存し、静止条件の画素一致と角度変更時の差を検査します。開発時のみ `/?material&freeze=1&light=1.8&tilt=.2` で同じ条件を再現できます。ベイク範囲外の角度では情報が不足するため、自由な照明変更・カメラ回転にはベイクの追加が必要です。`tests/optical-response.spec.ts` は77キー（ロゴキーを含む）と光源を60秒分動かし、毎フレームの光量重みが急に切り替わらないことを検査します。

## 検証と制作記録

機能テストと見た目の評価は別に扱います。氷のディスプレイとナビゲーションの静止画は `docs/qa/ice-display/`、Cyclesの検討画は `docs/qa/display-study/`。結果は `docs/qa/verification.md`。最新の動きは `npm run qa:motion` で撮影し、`docs/qa/motion/keyboard-motion.webm` に保存します。デスクトップ静止画は同フォルダの `floating-a.png`。最新のスマホ構図は `docs/qa/responsive/hero-390.png`、入力中は `native-input-390.png`（OSキーボード自体は表示せず、可視領域の縮小を再現）。初期の材質試作画像も `docs/qa/` に残しています。

文字フォントのDM Sansはローカル配信。ライセンスは `public/fonts/OFL-DM-Sans.txt`。

## Gitで管理する制作データ

ソース、依存関係のロックファイル、Blenderの `.blend`、GLB、配信用の光学アトラス、QA記録を含みます。`assets/blender/optical-motion/` のNumPy・プレビュー画像、`spectral-passes/` のEXR、`bake-cache/` は再生成できる大きな中間データなのでGitの対象外です。上記のBlenderスクリプトから再生成できます。実行にはBlenderと、梱包・検証用のNumPy / Pillowが必要です。通常のWeb起動にBlenderや中間キャッシュは必要ありません。

`node_modules`、`.next`、`.env*`、Blenderのバックアップも対象外です。
