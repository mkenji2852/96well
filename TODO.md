# TODO

## PostgreSQL production release follow-up

- [ ] GitHub Actions上の`postgres-integration` job結果をリリース判定に添付する。
- [ ] 本番相当の匿名化DBコピーで`postgres:baseline-check`、baseline、migration、backup/restore rehearsalを実行し、DBAレビュー記録を保存する。
- [ ] 本番DBAに`prisma/postgresql/hardening/roles.sql`のrole名、権限、監査ログ収集設定をレビューしてもらう。
- [ ] PostgreSQL server logまたはDB audit拡張でtrigger拒否イベントを検知する運用監視を有効化する。
- [ ] production接続のTLS、pool上限、statement timeout、deadlock retry policyを実インフラ設定へ反映する。

## BreakpointSet follow-up

- [ ] PostgreSQL本番相当環境で `prisma/postgresql/0007_breakpoint_set_immutability.sql` の適用、triggerによるUPDATE/INSERT/DELETE拒否、partial unique index、rollback手順を検証する。
- [ ] 作成者と承認者を必ず分離する施設向けに、organization policyとしてfour-eyes approvalを設定可能にする。
- [ ] CLSI/EUCAST/JANISの原典文書checksum・電子署名・配布元メタデータを検証する取り込みワークフローを追加する。

## P0 — 本番利用前に必須

- [ ] 本番OIDCのログインUI、token refresh、再認証後の停止中同期resumeを実装する
- [ ] PostgreSQL用Prisma migration、バックアップ、リストア試験、保存時暗号化を整備する
- [ ] 施設承認済みブレークポイントの登録・承認・失効・再計算UIを追加する
- [ ] RawMic/SIR履歴の監査レポートUIと差分レビューUIを追加する
- [ ] 監査ログの追記専用化、改ざん検知、保持期間、エクスポートを実装する
- [ ] 患者情報を扱う場合の脅威分析、法令・規制・施設ポリシー適合性を評価する

## P1 — ワークフロー完成

- [ ] reviewer用の電子署名、承認済み結果のロック、差戻し後の再レビュー導線を追加する
- [ ] 複数プレート、対照ウェル、replicate、ロット、培養条件、測定者をモデル化する
- [ ] オフラインでのサンプル作成、一時ID、ログイン切れ後の再送resumeを追加する
- [ ] オフライン競合UIにウェル差分の絞り込み、未解決競合カウント、監査ログ閲覧を追加する
- [ ] Excel出力に施設テンプレート選択、印刷設定、電子署名欄を追加する
- [ ] Excelファイルの暗号化保存、短時間署名URL、期限切れ後の再取得拒否、権限剥奪後のURL無効化を実配信基盤で実装する
- [ ] API統合テストを一時SQLite DBで実行する
- [ ] PlaywrightをCIへ組み込み、iOS Safari / Android Chrome / desktopを検証する

## P2 — 画像補助

- [ ] 署名付きアップロードと画像の保持・削除ポリシーを実装する
- [ ] FastAPI + OpenCV/PyTorch推論サービスを追加し、モデル版と前処理版を保存する
- [ ] ウェル位置補正、対照品質評価、confidence calibrationを検証する
- [ ] confidence 0.85閾値を検証データで校正し、低信頼・異常パターンを常にmanual reviewへ送る
- [ ] AI提案と人手確定値を並列表示し、上書き理由を監査ログへ記録する

## P3 — 運用・品質

- [ ] WCAG 2.2 AA監査、スクリーンリーダー、片手操作、屋外コントラストを検証する
- [ ] OpenAPI生成、API versioning、rate limit、構造化ログ、メトリクスを追加する
- [ ] PWA更新通知、キャッシュ移行、ストレージ容量警告を追加する
- [ ] MIC/rule engineへ施設検証済みgolden datasetとproperty-based testを追加する
