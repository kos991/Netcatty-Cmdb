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
	defer rows.Close()
	list := make([]CmdbWorkOrder, 0, q.PageSize)
	for rows.Next() {
		item, err := scanCmdbWorkOrder(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func (s *Store) CreateCmdbWorkOrderForProject(scope ProjectScope, w *CmdbWorkOrder) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if err := s.requireAssetInProject(s.db, scope.ProjectID, w.AssetID); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	if strings.TrimSpace(w.Subject) == "" {
		return 0, fmt.Errorf("维护主题不能为空")
	}
	if w.Status == "" {
		w.Status = "新建"
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_work_orders
		(project_id, order_no, priority, subject, biz_type, status, plan_time, actual_time, result, owner, maintainer, asset_id, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		scope.ProjectID, w.OrderNo, w.Priority, w.Subject, w.BizType, w.Status, w.PlanTime, w.ActualTime,
		w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(w.OrderNo) == "" {
		no := fmt.Sprintf("WO%s%04d", time.Now().Format("20060102"), id)
		if _, err := s.db.Exec(`UPDATE cmdb_work_orders SET order_no=? WHERE id=? AND project_id=?`, no, id, scope.ProjectID); err != nil {
			return id, err
		}
		w.OrderNo = no
	}
	w.ID = id
	w.ProjectID = scope.ProjectID
	if err := s.db.QueryRow(`SELECT sync_id FROM cmdb_work_orders WHERE id=? AND project_id=?`, id, scope.ProjectID).Scan(&w.SyncID); err != nil {
		return id, err
	}
	return id, nil
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
	res, err := s.db.Exec(`UPDATE cmdb_work_orders SET order_no=?, priority=?, subject=?, biz_type=?, status=?,
		plan_time=?, actual_time=?, result=?, owner=?, maintainer=?, asset_id=?, remark=?, updated_at=?
		WHERE id=? AND project_id=?`, w.OrderNo, w.Priority, w.Subject, w.BizType, w.Status,
		w.PlanTime, w.ActualTime, w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, w.ID, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) DeleteCmdbWorkOrderForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_work_orders WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("工单不属于当前项目: %w", ErrProjectScopedNotFound)
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
