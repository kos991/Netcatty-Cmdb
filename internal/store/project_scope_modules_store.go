package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) requireAssetInProject(q cmdbRelationQuerier, projectID, assetID int64) error {
	if assetID == 0 {
		return nil
	}
	var exists int
	err := q.QueryRow("SELECT 1 FROM cmdb_assets WHERE id = ? AND project_id = ? AND deleted_at IS NULL", assetID, projectID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("资产 %d 不属于当前项目: %w", assetID, ErrProjectScopedNotFound)
	}
	return err
}

func (s *Store) QueryCmdbWorkOrdersForProject(scope ProjectScope, q CmdbWorkOrderQuery) ([]CmdbWorkOrder, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 10
	}
	where, args := s.buildWorkOrderWhere(q)
	clause := " WHERE project_id = ?"
	queryArgs := []interface{}{scope.ProjectID}
	if where != "" {
		clause += " AND " + strings.TrimPrefix(where, " WHERE ")
		queryArgs = append(queryArgs, args...)
	}
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_work_orders"+clause, queryArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbWorkOrderSelect+clause+" ORDER BY id DESC LIMIT ? OFFSET ?", append(append([]interface{}{}, queryArgs...), q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return nil, 0, err
	}
	list := make([]CmdbWorkOrder, 0, q.PageSize)
	for rows.Next() {
		item, err := scanCmdbWorkOrder(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, 0, err
	}
	rows.Close()
	for index := range list {
		list[index].Assets, err = s.listWorkOrderAssetRefs(scope, list[index].ID)
		if err != nil {
			return nil, 0, err
		}
	}
	return list, total, nil
}

func (s *Store) CreateCmdbWorkOrderForProject(scope ProjectScope, w *CmdbWorkOrder) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, w.AssetID); err != nil {
		return 0, err
	}
	nowTime := time.Now()
	now := nowTime.Format("2006-01-02 15:04:05")
	if strings.TrimSpace(w.Subject) == "" {
		return 0, fmt.Errorf("维护主题不能为空")
	}
	if w.Status == "" {
		w.Status = "新建"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	orderNo, err := nextWorkOrderNumber(tx, scope.ProjectID, nowTime)
	if err != nil {
		return 0, err
	}
	res, err := tx.Exec(`INSERT INTO cmdb_work_orders
		(project_id, order_no, priority, subject, biz_type, operation_type, work_minutes, status, plan_time, actual_time, result, owner, maintainer, asset_id, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, orderNo, w.Priority, w.Subject, w.BizType, w.OperationType, w.WorkMinutes, w.Status, w.PlanTime, w.ActualTime,
		w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	w.OrderNo = orderNo
	w.ID = id
	w.ProjectID = scope.ProjectID
	if len(w.Assets) == 0 && w.AssetID > 0 {
		w.Assets = []WorkOrderAssetRef{{AssetType: "infrastructure", AssetID: w.AssetID}}
	}
	if err := s.replaceWorkOrderAssetRefs(tx, scope, id, w.Assets); err != nil {
		return 0, err
	}
	if err := tx.QueryRow(`SELECT sync_id FROM cmdb_work_orders WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&w.SyncID); err != nil {
		return id, err
	}
	if err := tx.Commit(); err != nil {
		return id, err
	}
	return id, nil
}

func nextWorkOrderNumber(tx *sql.Tx, projectID int64, now time.Time) (string, error) {
	prefix, separator, datePattern, resetPeriod := "GD", "-", "YYYYMMDD", "每日"
	digits := int64(4)
	err := tx.QueryRow(`SELECT name, vendor, version, remark, sort_order
		FROM cmdb_work_order_rules WHERE project_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`, projectID).
		Scan(&prefix, &separator, &datePattern, &resetPeriod, &digits)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return "", errors.New("工单编号规则缺少固定前缀")
	}
	if separator != "-" && separator != "_" {
		separator = ""
	}
	dateValue := ""
	switch strings.ToUpper(strings.TrimSpace(datePattern)) {
	case "YYYY":
		dateValue = now.Format("2006")
	case "YYYYMM":
		dateValue = now.Format("200601")
	case "YYYYMMDD":
		dateValue = now.Format("20060102")
	case "", "NONE":
	default:
		return "", fmt.Errorf("不支持的工单编号日期段: %s", datePattern)
	}
	if digits < 3 || digits > 8 {
		return "", errors.New("工单编号流水号位数必须为 3 到 8")
	}
	where := "project_id=?"
	args := []interface{}{projectID}
	switch strings.TrimSpace(resetPeriod) {
	case "每日":
		where += " AND created_at>=?"
		args = append(args, now.Format("2006-01-02 00:00:00"))
	case "每月":
		where += " AND created_at>=?"
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		args = append(args, monthStart.Format("2006-01-02 15:04:05"))
	case "每年":
		where += " AND created_at>=?"
		args = append(args, now.Format("2006-01-01 00:00:00"))
	case "不重置", "":
	default:
		return "", fmt.Errorf("不支持的工单编号重置周期: %s", resetPeriod)
	}
	var sequence int64
	if err := tx.QueryRow("SELECT COALESCE(MAX(CAST(SUBSTR(order_no, ?) AS INTEGER)), 0) FROM cmdb_work_orders WHERE "+where, append([]interface{}{-int(digits)}, args...)...).Scan(&sequence); err != nil {
		return "", err
	}
	parts := []string{prefix}
	if dateValue != "" {
		parts = append(parts, dateValue)
	}
	parts = append(parts, fmt.Sprintf("%0*d", digits, sequence+1))
	return strings.Join(parts, separator), nil
}

func (s *Store) GetCmdbWorkOrderForProject(scope ProjectScope, id int64) (*CmdbWorkOrder, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	item, err := scanCmdbWorkOrder(s.db.QueryRow(cmdbWorkOrderSelect+" WHERE project_id=? AND id=?", scope.ProjectID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err != nil {
		return nil, err
	}
	item.Assets, err = s.listWorkOrderAssetRefs(scope, item.ID)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) UpdateCmdbWorkOrderForProject(scope ProjectScope, w *CmdbWorkOrder) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if strings.TrimSpace(w.Subject) == "" {
		return fmt.Errorf("维护主题不能为空")
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, w.AssetID); err != nil {
		return err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE cmdb_work_orders SET order_no=?, priority=?, subject=?, biz_type=?, operation_type=?, work_minutes=?, status=?,
		plan_time=?, actual_time=?, result=?, owner=?, maintainer=?, asset_id=?, remark=?, updated_at=?
		WHERE id=? AND project_id=?`, w.OrderNo, w.Priority, w.Subject, w.BizType, w.OperationType, w.WorkMinutes, w.Status,
		w.PlanTime, w.ActualTime, w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, w.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if len(w.Assets) == 0 && w.AssetID > 0 {
		w.Assets = []WorkOrderAssetRef{{AssetType: "infrastructure", AssetID: w.AssetID}}
	}
	if err := s.replaceWorkOrderAssetRefs(tx, scope, w.ID, w.Assets); err != nil {
		return err
	}
	return tx.Commit()
}

// BatchUpdateCmdbWorkOrdersStatusForProject 批量结束当前项目内的工单。
// 工单结束统一使用「已关闭」，同时补齐完成时间，不跨项目修改记录。
func (s *Store) BatchUpdateCmdbWorkOrdersStatusForProject(scope ProjectScope, ids []int64, status string) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if strings.TrimSpace(status) != "已关闭" {
		return 0, fmt.Errorf("批量结束工单只允许使用「已关闭」状态")
	}
	unique := make([]int64, 0, len(ids))
	seen := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return 0, fmt.Errorf("至少选择一张有效工单")
	}
	placeholders := make([]string, len(unique))
	args := []interface{}{"已关闭"}
	now := time.Now().Format("2006-01-02 15:04:05")
	args = append(args, now, now, scope.ProjectID)
	for i, id := range unique {
		placeholders[i] = "?"
		args = append(args, id)
	}
	result, err := s.db.Exec(`UPDATE cmdb_work_orders SET status=?,
		actual_time=CASE WHEN IFNULL(actual_time,'')='' THEN ? ELSE actual_time END,
		updated_at=? WHERE project_id=? AND id IN (`+strings.Join(placeholders, ",")+")", args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) replaceWorkOrderAssetRefs(tx *sql.Tx, scope ProjectScope, workOrderID int64, refs []WorkOrderAssetRef) error {
	if _, err := tx.Exec(`DELETE FROM cmdb_work_order_asset_links WHERE project_id=? AND work_order_id=?`, scope.ProjectID, workOrderID); err != nil {
		return err
	}
	for _, ref := range refs {
		name, err := workOrderAssetName(tx, scope.ProjectID, ref.AssetType, ref.AssetID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO cmdb_work_order_asset_links(project_id,work_order_id,asset_type,asset_id,asset_name,created_at)
			VALUES(?,?,?,?,?,?)`, scope.ProjectID, workOrderID, ref.AssetType, ref.AssetID, name, time.Now().Format("2006-01-02 15:04:05")); err != nil {
			return err
		}
	}
	return nil
}

func workOrderAssetName(q cmdbRelationQuerier, projectID int64, assetType string, assetID int64) (string, error) {
	if assetID <= 0 {
		return "", errors.New("关联资产 ID 无效")
	}
	var name string
	var err error
	switch assetType {
	case "terminal":
		err = q.QueryRow(`SELECT COALESCE(NULLIF(asset_code,''), NULLIF(device_type,''), '#' || id) FROM assets WHERE project_id=? AND id=?`, projectID, assetID).Scan(&name)
	case "infrastructure":
		err = q.QueryRow(`SELECT COALESCE(NULLIF(name,''), NULLIF(asset_code,''), '#' || id) FROM cmdb_assets WHERE project_id=? AND id=? AND deleted_at IS NULL`, projectID, assetID).Scan(&name)
	case "application":
		err = q.QueryRow(`SELECT app_name FROM server_apps WHERE project_id=? AND id=?`, projectID, assetID).Scan(&name)
	default:
		return "", fmt.Errorf("不支持的关联资产类型: %s", assetType)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("关联资产不存在或不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return name, err
}

func (s *Store) listWorkOrderAssetRefs(scope ProjectScope, workOrderID int64) ([]WorkOrderAssetRef, error) {
	rows, err := s.db.Query(`SELECT asset_type,asset_id,asset_name FROM cmdb_work_order_asset_links
		WHERE project_id=? AND work_order_id=? ORDER BY id`, scope.ProjectID, workOrderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := make([]WorkOrderAssetRef, 0)
	for rows.Next() {
		var ref WorkOrderAssetRef
		if err := rows.Scan(&ref.AssetType, &ref.AssetID, &ref.AssetName); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

func (s *Store) DeleteCmdbWorkOrderForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if _, err := s.GetCmdbWorkOrderForProject(scope, id); err != nil {
		return err
	}
	originalDir, stagedDir, err := s.stageWorkOrderAttachmentDirectory(scope, id)
	if err != nil {
		return err
	}
	restoreAttachments := func() error {
		return restoreStagedWorkOrderAttachments(originalDir, stagedDir)
	}
	tx, err := s.db.Begin()
	if err != nil {
		_ = restoreAttachments()
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM cmdb_work_order_attachments WHERE project_id=? AND work_order_id=?`, scope.ProjectID, id); err != nil {
		_ = restoreAttachments()
		return err
	}
	if _, err := tx.Exec(`DELETE FROM cmdb_work_order_asset_links WHERE project_id=? AND work_order_id=?`, scope.ProjectID, id); err != nil {
		_ = restoreAttachments()
		return err
	}
	res, err := tx.Exec(`DELETE FROM cmdb_work_orders WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		_ = restoreAttachments()
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_ = restoreAttachments()
		return fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	if err := tx.Commit(); err != nil {
		if restoreErr := restoreAttachments(); restoreErr != nil {
			return fmt.Errorf("删除工单失败: %v；恢复附件目录失败: %w", err, restoreErr)
		}
		return err
	}
	if err := removeStagedWorkOrderAttachments(stagedDir); err != nil {
		return fmt.Errorf("工单已删除，但清理附件目录失败: %w", err)
	}
	return nil
}

func (s *Store) CountCmdbWorkOrdersForProject(scope ProjectScope) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_orders WHERE project_id=?`, scope.ProjectID).Scan(&n)
	return n, err
}

func (s *Store) QueryCmdbInventoryTasksForProject(scope ProjectScope, status, keyword string, page, pageSize int) ([]CmdbInventoryTask, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	where := []string{"project_id = ?"}
	args := []interface{}{scope.ProjectID}
	if v := strings.TrimSpace(status); v != "" && v != "全部状态" {
		where = append(where, "status = ?")
		args = append(args, v)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(name LIKE ? OR IFNULL(task_no,'') LIKE ? OR IFNULL(remark,'') LIKE ?)`)
		args = append(args, pat, pat, pat)
	}
	clause := " WHERE " + strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_inventory_tasks"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbInventorySelect+clause+" ORDER BY id DESC LIMIT ? OFFSET ?", append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := make([]CmdbInventoryTask, 0, pageSize)
	for rows.Next() {
		item, err := scanCmdbInventory(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func (s *Store) CreateCmdbInventoryTaskForProject(scope ProjectScope, v *CmdbInventoryTask) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	if strings.TrimSpace(v.Name) == "" {
		return 0, fmt.Errorf("任务名称不能为空")
	}
	if v.Status == "" {
		v.Status = "待执行"
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_inventory_tasks
		(project_id, task_no, name, status, progress, abnormal, deadline, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, v.TaskNo, v.Name, v.Status, v.Progress, v.Abnormal, v.Deadline, v.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(v.TaskNo) == "" {
		no := fmt.Sprintf("PD%s%04d", time.Now().Format("20060102"), id)
		if _, err := s.db.Exec(`UPDATE cmdb_inventory_tasks SET task_no=? WHERE id=? AND project_id=?`, no, id, scope.ProjectID); err != nil {
			return id, err
		}
		v.TaskNo = no
	}
	v.ID = id
	v.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_inventory_tasks WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&v.SyncID); err != nil {
		return id, err
	}
	return id, nil
}

func (s *Store) UpdateCmdbInventoryTaskForProject(scope ProjectScope, v *CmdbInventoryTask) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if strings.TrimSpace(v.Name) == "" {
		return fmt.Errorf("任务名称不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`UPDATE cmdb_inventory_tasks SET task_no=?, name=?, status=?, progress=?, abnormal=?,
		deadline=?, remark=?, updated_at=? WHERE id=? AND project_id=?`, v.TaskNo, v.Name, v.Status, v.Progress,
		v.Abnormal, v.Deadline, v.Remark, now, v.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("盘点任务不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbInventoryTaskForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_inventory_tasks WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("盘点任务不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) QueryCmdbCredentialsForProject(scope ProjectScope, credType, keyword string, page, pageSize int) ([]CmdbCredential, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	where := []string{"c.project_id = ?"}
	args := []interface{}{scope.ProjectID}
	if v := strings.TrimSpace(credType); v != "" && v != "全部类型" {
		where = append(where, "c.cred_type = ?")
		args = append(args, v)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(c.name LIKE ? OR IFNULL(c.description,'') LIKE ? OR IFNULL(c.cred_type,'') LIKE ?)`)
		args = append(args, pat, pat, pat)
	}
	clause := " WHERE " + strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_credentials c"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbCredentialSelect+clause+" ORDER BY c.id DESC LIMIT ? OFFSET ?", append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := make([]CmdbCredential, 0, pageSize)
	for rows.Next() {
		item, err := scanCmdbCredential(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func (s *Store) CreateCmdbCredentialForProject(scope ProjectScope, v *CmdbCredential) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if strings.TrimSpace(v.Name) == "" {
		return 0, fmt.Errorf("凭据名称不能为空")
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, v.AssetID); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT INTO cmdb_credentials
		(project_id, name, cred_type, description, asset_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
		scope.ProjectID, v.Name, v.CredType, v.Description, v.AssetID, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	v.ID = id
	v.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_credentials WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&v.SyncID); err != nil {
		return id, err
	}
	return id, nil
}

func (s *Store) UpdateCmdbCredentialForProject(scope ProjectScope, v *CmdbCredential) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	if strings.TrimSpace(v.Name) == "" {
		return fmt.Errorf("凭证名称不能为空")
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, v.AssetID); err != nil {
		return err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`UPDATE cmdb_credentials SET name=?, cred_type=?, description=?, asset_id=?, updated_at=?
		WHERE id=? AND project_id=?`, v.Name, v.CredType, v.Description, v.AssetID, now, v.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("凭据不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbCredentialForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_credentials WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("凭据不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}
