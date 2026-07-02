# MIC Plate Recorder

## Quick start for research/local use

Use this path only for research-only, local, non-clinical evaluation with synthetic or anonymized data.

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Then open:

```text
http://127.0.0.1:3000
```

If local Prisma migration is unavailable, initialize the SQLite database directly and then seed it:

```powershell
pnpm db:init
pnpm db:seed
pnpm dev
```

Do not use this quick-start path for clinical diagnosis, patient-identifying data, official laboratory reporting, or controlled production deployment.

## Research/local release scope

This application is currently released only for research-only, local, non-clinical use.

- Do not use it for clinical diagnosis, patient care, treatment decisions, official laboratory reporting, regulated operation, or controlled production deployment.
- Use synthetic, anonymized, or otherwise non-clinical data only.
- Do not enter patient names, patient IDs, medical record numbers, accession numbers, direct specimen identifiers, or other patient-identifying information.
- Review Excel exports before sharing. Prefer the `ANONYMIZED` export profile.
- Image analysis is assistive only and requires manual review.
- If the intended use changes to clinical, diagnostic, regulated, production, or patient-identifying data handling, complete the separate production evidence workflow first.

Release decision:

- Research/local/non-clinical use: CONDITIONAL GO, subject to the local smoke test and checklist.
- Clinical/diagnostic/regulated/controlled production use: NO-GO.

See:

- [Research Local Release](./docs/release/2026-07-01-research-local-release.md)
- [Research Local Release Notes](./docs/release/2026-07-01-research-local-release-notes.md)
- [Research Local Runbook](./docs/deployment/research-local-runbook.md)
- [Research Local Smoke Test](./docs/deployment/research-local-smoke-test.md)
- [Research Local Checklist](./docs/deployment/research-local-checklist.md)

## PostgreSQL本番リリース基盤

本番相当環境ではSQLite migrationを使用しません。PostgreSQL専用のPrisma schemaとmigrationを明示的に指定します。

```text
prisma/postgresql/schema.prisma
prisma/postgresql/migrations/0001_initial/migration.sql
prisma/postgresql/migrations/0002_production_hardening/migration.sql
prisma/postgresql/hardening/roles.sql
```

想定PostgreSQL versionは16です。CIの`postgres-integration` jobも`postgres:16` service containerを使用します。

### 接続URLとfail closed

実passwordはコミットしません。`.env.example`はダミー値のみです。

- `POSTGRES_PRISMA_DATABASE_URL`: migration user用。`prisma:postgres:*`で使用します。
- `POSTGRES_APP_DATABASE_URL`: application user用。本番実行時に必須です。
- `POSTGRES_TEST_DATABASE_URL`: PostgreSQL integration test用。
- `POSTGRES_APP_TEST_DATABASE_URL`: application user権限試験用。
- `POSTGRES_RESTORE_TEST_DATABASE_URL`: backup/restore rehearsal用。

`NODE_ENV=production`では`POSTGRES_APP_DATABASE_URL`が未設定、またはPostgreSQL URLでない場合に起動を拒否します。productionでSQLite `DATABASE_URL=file:...` を指定している場合も拒否します。

### PostgreSQL migration

空DBへの構築:

```bash
pnpm prisma:postgres:generate
pnpm prisma:postgres:validate
pnpm prisma:postgres:migrate
pnpm postgres:schema-diff
pnpm postgres:schema-check
```

`0001_initial`はPrisma datamodelから生成したPostgreSQL schemaです。`0002_production_hardening`はPrismaで表現できない以下を管理します。

- `RawMic_current_plate_drug_key`: `plateId + plateDrugId`の`status='CURRENT'` partial unique index
- `SirInterpretation_current_plate_drug_key`: `plateId + plateDrugId`の`status='CURRENT'` partial unique index
- `BreakpointSet_formal_org_standard_version_key`: APPROVED/RETIREDの`organizationId + standard + version` partial unique index
- 96ウェル範囲、breakpoint境界値、effective期間、hash metadata、承認/失効metadataのcheck constraint
- APPROVED/RETIRED BreakpointSet本体とBreakpointRuleの直接UPDATE/DELETE/INSERT拒否trigger

triggerエラーはテストで判定できるよう、`AST_BREAKPOINT_IMMUTABLE_SET_CONTENT`、`AST_BREAKPOINT_IMMUTABLE_RULE`などの固定messageを返します。

### BreakpointSet contentHash

承認時に以下を保存します。

- `contentHash`
- `contentHashAlgorithm = sha256`
- `contentHashVersion = 1`

hash対象に含める項目:

- BreakpointSet本体: `standard`, `version`, `organism`, `unit`, `method`, `effectiveFrom`, `effectiveTo`, `sourceDocumentReference`, `sourceDocumentChecksum`
- 全BreakpointRule: `drugName`, `organism`, `standard`, `version`, `susceptibleMax`, `intermediateMin`, `intermediateMax`, `resistantMin`, `unit`, `method`, `exceptionJson`

hash対象に含めない項目:

- DB内部ID、status、revision、作成/承認/失効ユーザー、作成/更新timestamp、監査ログ

canonicalizationはUnicode NFC、JSON key sort、rule安定sort、ISO timestamp、`null`明示、SHA-256です。MIC/SIR計算と正式Excel出力はhash、algorithm、versionを再検証し、不一致なら拒否して監査します。

### 既存DB baseline / P3005対応

既存DBにテーブルがあり`_prisma_migrations`が無い場合、`prisma migrate resolve --applied`を無条件実行してはいけません。

安全手順:

1. 本番DBを停止またはmaintenance modeへ移行
2. `pg_dump --format=custom`でバックアップ
3. restore rehearsal用DBへ復元し、バックアップ検証
4. 本番相当コピーで`pnpm postgres:baseline-check`
5. `UNSAFE_TO_BASELINE`が1件でもあれば停止
6. DBA/責任者レビュー後のみ`BACKUP_CONFIRMED=yes BASELINE_APPROVED=yes pnpm postgres:baseline`
7. `pnpm prisma:postgres:migrate`
8. `pnpm postgres:schema-check`
9. smoke test
10. restore test結果をリリース記録へ保存

CIでは、migration SQLを直接適用して`_prisma_migrations`が無い既存DB相当環境を作成し、baseline rehearsalを実行します。

### DBユーザー権限分離

`prisma/postgresql/hardening/roles.sql`をDBA権限で適用します。role作成とpassword管理はSecret Manager側で行い、SQLには実passwordを書きません。

- migration user: schema変更、migration、trigger/function/index/constraint作成用。通常アプリ実行に使用しません。
- application user: 業務tableへの必要最小限のSELECT/INSERT/UPDATE、一部DRAFT rule削除のみ。DDL、DROP、TRUNCATE、trigger無効化は禁止。
- read-only/audit user: 必要に応じてSELECTのみ。

### backup / restore

合成データまたは匿名化データで以下を実行します。

```bash
pnpm postgres:backup-restore-check
```

このスクリプトは`pg_dump`でcustom format backupを作成し、`POSTGRES_RESTORE_TEST_DATABASE_URL`へ`pg_restore --clean --if-exists`で復元後、`pnpm postgres:schema-check`を実行します。

Prisma migrationはdown migrationを前提にしません。失敗時はbackup restoreを正式rollback手順とします。hardening SQLのみ失敗した場合もDBをリリース不可とし、原因修正後に本番相当コピーで再検証します。

### CI

GitHub Actionsは以下のジョブを持ちます。

- `sqlite-unit`: `pnpm lint`, `pnpm test`, `pnpm build`
- `postgres-integration`: PostgreSQL 16でPG generate/validate/migrate/schema check、role分離、integration test、backup/restore、baseline rehearsal
- `e2e`: Playwright E2E

PostgreSQL jobが失敗した場合、SQLite testが成功していてもmerge不可とします。

#### postgres-integration jobで実行する全コマンド

CI上の`postgres-integration` jobは、PostgreSQL 16 service containerを起動したうえで以下を順に実行します。ログには実passwordや本番URLを出力しない前提です。

```bash
corepack enable
pnpm install --frozen-lockfile
psql ... -c "CREATE DATABASE ast_restore"
psql ... -c "CREATE DATABASE ast_legacy"
psql ... -c "CREATE ROLE ast_app LOGIN PASSWORD '...'"
psql ... -c "CREATE ROLE ast_readonly LOGIN PASSWORD '...'"
pnpm prisma:postgres:generate
pnpm prisma:postgres:validate
pnpm prisma:postgres:migrate
pnpm postgres:schema-diff
pnpm postgres:hardening
psql ... -f prisma/postgresql/hardening/roles.sql
pnpm test:postgres
pnpm postgres:backup-restore-check
psql ... -d ast_legacy -f prisma/postgresql/migrations/0001_initial/migration.sql
psql ... -d ast_legacy -f prisma/postgresql/migrations/0002_production_hardening/migration.sql
psql ... -d ast_legacy -f prisma/postgresql/fixtures/legacy-data.sql
pnpm postgres:baseline-check
BACKUP_CONFIRMED=yes BASELINE_APPROVED=yes pnpm postgres:baseline
pnpm prisma:postgres:migrate
```

#### postgres-integration jobで期待する検証内容

- PostgreSQL schemaで`prisma generate`と`prisma validate`が成功する。
- 空PostgreSQL DBに`prisma migrate deploy --schema prisma/postgresql/schema.prisma`が成功する。
- SQLite schemaとPostgreSQL schemaがdatasource以外で意図せず乖離していない。
- `RawMic`と`SirInterpretation`のCURRENT partial unique indexが存在する。
- `BreakpointSet` formal version partial unique indexが存在する。
- BreakpointSet/BreakpointRule不変性triggerが存在する。
- `Role.AUDITOR`、`BreakpointSetStatus.APPROVED`、`ResultRecordStatus.CURRENT`など必須enum値が存在する。
- APPROVED/RETIRED BreakpointSet本体のDB直UPDATE/DELETEがtriggerで拒否される。
- APPROVED/RETIRED配下BreakpointRuleのDB直INSERT/UPDATE/DELETEがtriggerで拒否される。
- DRAFT BreakpointSetとclone相当DRAFTは編集可能。
- RawMic/SirInterpretationのCURRENT重複がpartial unique indexで拒否される。
- application DB userでDDLやtrigger無効化が拒否される。
- backup/restore rehearsal後もschema checkが成功する。
- `_prisma_migrations`が無い既存DB相当環境で、baseline checkがschema不一致を検出でき、明示承認付きbaselineのみが進む。
- legacy fixtureではactor NULL audit、IMAGE_ASSISTED旧well、旧RawMic/SIR、非ASCII長文notes、DRAFT扱いのlegacy BreakpointSetが保持される。

#### postgres-integration jobの停止条件

以下のいずれかでjobは失敗し、merge不可とします。

- PostgreSQL service containerがhealth checkに失敗する。
- `pnpm install --frozen-lockfile`がlockfile不一致で失敗する。
- PostgreSQL以外のURL、または誤ったschema providerが指定される。
- `prisma:postgres:generate`、`validate`、`migrate`のいずれかが失敗する。
- hardening SQLのtrigger、constraint、partial unique indexが作成されない。
- `postgres:schema-diff`でSQLite/PG schemaがdatasource以外で乖離する。
- `postgres:schema-check`が`UNSAFE_TO_BASELINE`または必須object欠落を返す。
- application userがDDL、DROP、trigger無効化を実行できてしまう。
- APPROVED/RETIRED BreakpointSetまたはRuleのDB直変更が成功してしまう。
- RawMic/SIR CURRENT重複が成功してしまう。
- backup/restore後のschema checkが失敗する。
- baseline対象DBにschema不一致があるのに`postgres:baseline`が進む。
- `BACKUP_CONFIRMED=yes`と`BASELINE_APPROVED=yes`が無いbaseline実行が進む。
- PostgreSQL integration testが1件でも失敗する。

## BreakpointSet lifecycle

BreakpointSetは `DRAFT -> APPROVED -> RETIRED` の一方向状態遷移で管理します。管理画面は `/breakpoints` です。

- ADMINだけがDRAFT作成、本体編集、rule追加・更新・削除、承認、失効、cloneを実行できます。
- REVIEWER/TECHNICIAN/AUDITORは自施設のセットを参照できます。Plate入力と画像レビューでは、承認済みかつ有効期間内のセットだけを明示選択します。最新versionの暗黙選択は行いません。
- APPROVED/RETIREDの本体とruleはAPIサービス層、SQLite trigger、PostgreSQL用triggerで変更・削除を拒否します。
- 変更は `POST /api/breakpoint-sets/:id/clone` で独立したDRAFTを作り、`supersedesBreakpointSetId` で旧版へ接続します。
- 承認時は本体と全ruleをcanonical JSONへ正規化し、安定キーでruleを並べ、SHA-256を `contentHash` に保存します。MIC/SIR計算とExcel出力はhashを再計算し、不一致なら正式処理を拒否します。
- RETIREDは新規計算の選択肢に出ません。過去のRawMic/SirInterpretation/ExportRecordからの参照と表示は維持されます。
- BreakpointSetを変更して再計算する場合は理由が必須で、`BREAKPOINT_SELECTION_CHANGED` として監査されます。

主なAPI:

```text
GET    /api/breakpoint-sets
GET    /api/breakpoint-sets/:id
POST   /api/breakpoint-sets
PATCH  /api/breakpoint-sets/:id
POST   /api/breakpoint-sets/:id/rules
PATCH  /api/breakpoint-sets/:id/rules/:ruleId
DELETE /api/breakpoint-sets/:id/rules/:ruleId
POST   /api/breakpoint-sets/:id/approve
POST   /api/breakpoint-sets/:id/retire
POST   /api/breakpoint-sets/:id/clone
```

Migration `0007_breakpoint_set_lifecycle` は既存のapproved相当データを自動承認せずDRAFTへ移行します。内容を確認し、管理画面から明示的に承認してください。`pnpm test` はclean SQLite DBと既存DB相当コピーへのmigration、foreign key、trigger不変性を検証します。

PostgreSQL本番ではPrisma migration適用後に `prisma/postgresql/0007_breakpoint_set_immutability.sql` を適用し、triggerとformal version用partial unique indexを有効化してください。ローカル標準環境はSQLiteのため、PostgreSQL実機での適用・rollback・権限確認はリリース環境のCIで別途実行する必要があります。

## Image review UI

- The reviewer/admin image review screen is available at `/review/image`.
- `ImagePrediction` is displayed as unverified assistive evidence. The UI keeps reviewer edits separate from the prediction and never writes final `PlateWell`, MIC, S/I/R, or Excel results directly.
- Approval, rejection, and well override actions call the existing server APIs only. The UI shows `APPROVED` or `REJECTED` only after a successful API response.
- If `NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false`, the image review screen is disabled and the client does not call image review APIs.
- TECHNICIAN users do not see approval or rejection controls. Server-side authentication, role checks, and organization scope remain authoritative.

96穴プレートの微量液体希釈法による薬剤感受性試験を、スマホ中心で記録・レビュー・Excel出力するMVPです。日本語UIを既定とし、PWA、IndexedDB、Prisma、ExcelJS、任意の画像解析補助サービスを組み合わせます。

## 構成

```text
src/
  app/                 Next.js App Router / API Routes
  components/          96穴プレート入力UI
  lib/                 MIC計算、S/I/R rule engine、RBAC、画像解析adapter、Excel出力
  types/               API・ドメイン型
prisma/
  schema.prisma        開発用SQLite schema。本番PostgreSQLへの移行を想定
image-service/          FastAPI + OpenCV の画像解析補助サービス
e2e/                    Playwright mobile E2E
```

## 前提

- Node.js 20.9以上
- pnpm 10以上
- Python 3.11以上（画像解析補助サービスを使う場合）
- 開発DBはSQLite。本番ではPostgreSQL datasourceとmigration検証が必要
- 臨床判断に使うbreakpointは、施設で承認済みの版を登録して使うこと

## 起動方法

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Prisma CLIが利用できない制限環境では、同じmigration SQLをSQLiteへ適用する `pnpm db:init` も利用できます。

## 認証・認可

APIは汎用OIDC resource serverとしてBearer access tokenを検証します。`x-user-role`、`x-user-id`、`x-organization-id` のようなクライアント自己申告ヘッダーは権限判断に使用しません。

OIDC tokenの `sub` をDBの `User.externalSubject` に対応付け、roleとorganizationはDBから取得します。tokenにはセッション追跡用の `sid` または `jti` が必要です。

本番では以下が必須です。不足時はfail closedでリクエストを拒否します。client secretはこのリポジトリへ書かないでください。

```dotenv
OIDC_ISSUER=https://identity.example.com/
OIDC_AUDIENCE=mic-plate-api
OIDC_JWKS_URL=https://identity.example.com/.well-known/jwks.json
```

開発用認証は `NODE_ENV=development` かつ明示的に有効化した場合だけ使えます。

```dotenv
DEV_AUTH_ENABLED=true
DEV_AUTH_USER_ID=dev-admin
```

すべてのRoute Handlerで、認証、permission、organization ownershipを確認します。sampleとplateは別施設からは `NOT_FOUND` として扱います。breakpoint登録は `POST /api/breakpoints` に分離され、ADMINのみ実行できます。audit actorは認証済みUser IDです。

## 画像解析MVPとmanual review

画像解析結果は最終判定ではなく、必ず補助判定として扱います。confidenceが1.0でも自動承認しません。

- `POST /api/plates/:plateId/image-assessments` はmultipart画像だけを受け付けます。
- クライアント送信の `confidence`、`modelVersion`、`predictedStates` は正式な解析結果として採用しません。
- 正式な `ImagePrediction` は、サーバーが画像解析サービスから受け取ったレスポンスだけで作成します。
- 新規の画像解析結果は常に `REVIEW_REQUIRED`、`manualReviewRequired=true` から始まります。
- 未承認predictionは `PlateWell`、Raw MIC、S/I/R、Excel正式結果へ反映しません。
- REVIEWERまたはADMINだけが承認・差戻し・overrideできます。TECHNICIANは画像アップロードとレビュー依頼までです。

主な状態遷移:

```text
ImageAssessment: PROCESSING -> REVIEW_REQUIRED -> APPROVED
                                      └-------> REJECTED
                         └----------> ANALYSIS_FAILED

Plate: DRAFT -> REVIEW_REQUIRED -> APPROVED
```

画像サービスの起動:

```powershell
cd image-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Next.js側は既定で `http://127.0.0.1:8001` を参照します。別ホストの場合は `IMAGE_ANALYSIS_URL` を設定してください。

## テストとビルド

```powershell
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
cd image-service
.\.venv\Scripts\python.exe -m pytest -q
```

## データ分離

- `PlateWell`: 人が手入力、またはreview済み画像結果として確定したウェル値。正式計算は `MANUAL` と `IMAGE_REVIEWED` のみを参照
- `ImagePrediction`: 画像解析サービスから返った未検証の予測値、confidence、modelVersion、QC情報
- `ImageReview`: reviewer、承認/差戻し、理由、確認済みウェル、override概要
- `ImageWellOverride`: ウェル単位overrideのbefore/after、理由、reviewer、timestamp、prediction/modelVersion
- `BreakpointSet`: 1回の計算で固定して使うbreakpoint標準・版・対象菌種のセット。未承認、失効、対象菌種外のsetは計算に使えません
- `RawMic`: 確定済みウェルデータから導出したraw MIC。append-onlyで、再計算時は旧 `CURRENT` を `SUPERSEDED` にして新しい `CURRENT` を作成します
- `SirInterpretation`: breakpointSet付きのS/I/R派生値。RawMicと同じくappend-onlyで、`supersedesId` により履歴を辿れます
- `AuditLog`: actor、action、対象、before/after JSON、timestamp

## 結果履歴と再計算

MIC/S/I/R結果は物理削除しません。再計算はDB transaction内で行い、同じplate+drugのCURRENT重複を防ぐためにpartial unique indexとPlateの`resultRevision`によるoptimistic concurrencyを使います。

- 入力元ウェルは `MANUAL` または `IMAGE_REVIEWED` の確定値だけです
- `breakpointSetId` は計算ごとに必須です。未指定の場合、最新breakpointを自動選択しません
- `RawMic` には `sourceWellRevision`、`calculationEngineVersion`、`breakpointSetId`、`createdByUserId` を保存します
- `SirInterpretation` には `ruleEngineVersion`、`breakpointSetId`、`calculatedByUserId` を保存します
- Excel SummaryはCURRENTのみを出力し、RawMic ID / SirInterpretation ID / breakpointSetId / engine versionを含みます
- `InterpretationHistory` は `AUDIT_FULL` profileでのみ出力します

## Excel出力のセキュリティとプライバシー

Excel出力は目的別プロファイルで制御します。既定は `ANONYMIZED` です。

- `ANONYMIZED`: `Summary` / `Wells` / `Method` のみ。sample code、notes、actor、内部DB ID、raw audit JSONは含めません。exportごとのランダムなpseudonymous sample IDを使います
- `CLINICAL_INTERNAL`: 施設内利用向け。sample codeと技術追跡列を含められます。notesは `export:notes` 権限と明示確認がある場合だけ含めます
- `AUDIT_FULL`: ADMIN/AUDITOR向け。理由必須。`ReviewHistory`、`InterpretationHistory`、`Audit`、`ExportMetadata` を含めます。監査JSONはそのまま1セルへ入れず、許可済みフィールドへ展開します

権限:

- `export:anonymized`: 匿名化出力
- `export:clinical`: 施設内臨床出力
- `export:audit`: 監査出力
- `export:notes`: notesを含める出力

すべての出力で認証、role、organization scopeをRoute Handlerで確認します。他施設Plateは404です。ファイル名は `ast-export-<exportId>.xlsx` 形式で、sample codeやUser IDを含めません。`Content-Disposition` は固定形式で生成し、`Cache-Control: private, no-store, max-age=0` を設定します。

出力開始時に `plateRevision`、`wellRevision`、`resultRevision`、`breakpointSetId`、使用したRawMic ID、SirInterpretation ID、ImageReview IDをsnapshotとして確定し、`ExportRecord.metadataJson` に保存します。Excel生成はこのsnapshotのIDだけを参照します。通常出力ではbreakpointSetやstandard/versionの混在を拒否し、混在を許可する場合は `AUDIT_FULL` 限定です。

ユーザー入力文字列はExcel formula injection対策として、`=`、`+`、`-`、`@`、タブ、改行で始まる場合に文字列として安全化します。ユーザー入力をExcelJSのformulaプロパティには設定しません。

## オフライン同期と競合制御

プレート入力はIndexedDBへ自動保存され、ユーザー・施設・実行環境単位でドラフトと同期キューを分離します。旧形式のIndexedDBドラフトは安全のため自動送信しません。

- `PUT /api/plates/:id` は `expectedRevision` または `If-Match` が必須です。未指定は `428 PRECONDITION_REQUIRED` です
- 保存成功時はサーバーが新しい `wellRevision` を返し、成功したドラフトとキューだけをIndexedDB transactionで削除します
- revision不一致時は `409 REVISION_CONFLICT` を返し、`serverRevision`、`serverWellRevision`、`serverUpdatedAt`、`serverUpdatedBy`、`serverWells` を含む競合payloadを返します
- クライアントは3-way mergeで非競合ウェルだけ再適用できます。同じウェルを双方が異なる値へ変更した場合は手動確認に回し、強制上書きボタンは提供しません
- `idempotency-key` により同じ保存リクエストの重複適用を防ぎます。同じkeyを異なるbodyに再利用した場合は409です
- 同期はアプリ起動、ログイン後、onlineイベント、手動同期、安全な定期retryで行います。Web LocksとBroadcastChannelにより複数タブの重複送信を抑制します
- 401は再認証待ち、403/404/400/422/428は非retry、409はCONFLICT、5xx/network errorは上限付き指数backoffとして扱います
- クライアントはRawMic/S/I/R履歴や未承認ImagePredictionを同期しません。正式計算はサーバー側で確定ウェルから再計算します

## 非対応・残作業

- 本番OIDCのログインUIとtoken取得フロー
- 画像ファイル本体の永続保管、暗号化、保持期間ポリシー
- PostgreSQL向けmigrationの本番検証
- WORM相当の監査ログ保全
- CLSI/EUCAST/JANIS等の公式breakpoint配布との同期
- オフライン同期の競合解決UIの詳細な差分表示、再認証後の自動resume、バックグラウンド同期API対応
- Excelファイルの永続保存、暗号化管理ストレージ、短時間署名URL、期限切れ後取得拒否の実配信基盤

詳細な残作業は [TODO.md](./TODO.md) を参照してください。
