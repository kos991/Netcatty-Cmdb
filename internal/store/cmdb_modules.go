package store

import (
	"fmt"
	"strings"
	"time"
)

// ============================ 工单管理 ============================

type CmdbWorkOrder struct {
	ID         int64  `json:"id"`
	OrderNo    string `json:"order_no"`
	Priority   string `json:"priority"`
	Subject    string `json:"subject"`
	BizType    string `json:"biz_type"`
	Status     string `json:"status"`
	PlanTime   string `json:"plan_time"`
	ActualTime string `json:"actual_time"`
	Result     string `json:"result"`
	Owner      string `json:"owner"`
	Maintainer string `json:"maintainer"`
	AssetID    int64  `json:"asset_id"`
	Remark     string `json:"remark"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type CmdbWorkOrderQuery struct {
	Keyword    string
	BizType    string
	Status     string
	Result     string
	Owner      string
	Maintainer string
	Page       int
	PageSize   int
}

const cmdbWorkOrderSelect = `SELECT id, IFNULL(order_no,''), IFNULL(priority,''), subject,
	IFNULL(biz_type,''), IFNULL(status,''), IFNULL(plan_time,''), IFNULL(actual_time,''),
	IFNULL(result,''), IFNULL(owner,''), IFNULL(maintainer,''), asset_id, IFNULL(remark,''),
	IFNULL(created_at,''), IFNULL(updated_at,'') FROM cmdb_work_orders`

func scanCmdbWorkOrder(sc interface{ Scan(...interface{}) error }) (CmdbWorkOrder, error) {
	var w CmdbWorkOrder
	err := sc.Scan(&w.ID, &w.OrderNo, &w.Priority, &w.Subject, &w.BizType, &w.Status,
		&w.PlanTime, &w.ActualTime, &w.Result, &w.Owner, &w.Maintainer, &w.AssetID,
		&w.Remark, &w.CreatedAt, &w.UpdatedAt)
	return w, err
}

func (s *Store) buildWorkOrderWhere(q CmdbWorkOrderQuery) (string, []interface{}) {
	var where []string
	var args []interface{}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(subject LIKE ? OR IFNULL(order_no,'') LIKE ? OR IFNULL(owner,'') LIKE ?
			OR IFNULL(maintainer,'') LIKE ? OR IFNULL(remark,'') LIKE ?)`)
		args = append(args, pat, pat, pat, pat, pat)
	}
	for _, f := range []struct {
		col, val string
	}{
		{"biz_type", q.BizType}, {"status", q.Status}, {"result", q.Result},
		{"owner", q.Owner}, {"maintainer", q.Maintainer},
	} {
		if v := strings.TrimSpace(f.val); v != "" && v != "所有类型" && v != "所有状态" && v != "所有结果" && v != "所有负责人" && v != "所有维护人员" {
			where = append(where, f.col+" = ?")
			args = append(args, v)
		}
	}
	if len(where) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(where, " AND "), args
}

func (s *Store) QueryCmdbWorkOrders(q CmdbWorkOrderQuery) ([]CmdbWorkOrder, int, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 10
	}
	where, args := s.buildWorkOrderWhere(q)

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_work_orders"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := cmdbWorkOrderSelect + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.Query(query, append(append([]interface{}{}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
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

func (s *Store) GetCmdbWorkOrder(id int64) (*CmdbWorkOrder, error) {
	row := s.db.QueryRow(cmdbWorkOrderSelect+" WHERE id = ?", id)
	item, err := scanCmdbWorkOrder(row)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *Store) CreateCmdbWorkOrder(w *CmdbWorkOrder) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	if strings.TrimSpace(w.Subject) == "" {
		return 0, fmt.Errorf("维护主题不能为空")
	}
	if w.Status == "" {
		w.Status = "新建"
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_work_orders
		(order_no, priority, subject, biz_type, status, plan_time, actual_time, result, owner, maintainer, asset_id, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		w.OrderNo, w.Priority, w.Subject, w.BizType, w.Status, w.PlanTime, w.ActualTime,
		w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	// 工单号未指定时用「WO + 日期 + 自增ID」生成，
	// 避免同一秒内连续创建产生重复工单号。
	if strings.TrimSpace(w.OrderNo) == "" {
		no := fmt.Sprintf("WO%s%04d", time.Now().Format("20060102"), id)
		if _, err := s.db.Exec(`UPDATE cmdb_work_orders SET order_no=? WHERE id=?`, no, id); err != nil {
			return id, err
		}
		w.OrderNo = no
	}
	return id, nil
}

func (s *Store) UpdateCmdbWorkOrder(w *CmdbWorkOrder) error {
	if strings.TrimSpace(w.Subject) == "" {
		return fmt.Errorf("维护主题不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE cmdb_work_orders SET order_no=?, priority=?, subject=?, biz_type=?,
		status=?, plan_time=?, actual_time=?, result=?, owner=?, maintainer=?, asset_id=?, remark=?, updated_at=?
		WHERE id=?`,
		w.OrderNo, w.Priority, w.Subject, w.BizType, w.Status, w.PlanTime, w.ActualTime,
		w.Result, w.Owner, w.Maintainer, w.AssetID, w.Remark, now, w.ID)
	return err
}

func (s *Store) DeleteCmdbWorkOrder(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cmdb_work_orders WHERE id=?`, id)
	return err
}

func (s *Store) CountCmdbWorkOrders() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_work_orders`).Scan(&n)
	return n, err
}

// ============================ 资产盘点 ============================

type CmdbInventoryTask struct {
	ID        int64  `json:"id"`
	TaskNo    string `json:"task_no"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Progress  int64  `json:"progress"`
	Abnormal  int64  `json:"abnormal"`
	Deadline  string `json:"deadline"`
	Remark    string `json:"remark"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

const cmdbInventorySelect = `SELECT id, IFNULL(task_no,''), name, IFNULL(status,''), progress,
	abnormal, IFNULL(deadline,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'')
	FROM cmdb_inventory_tasks`

func scanCmdbInventory(sc interface{ Scan(...interface{}) error }) (CmdbInventoryTask, error) {
	var v CmdbInventoryTask
	err := sc.Scan(&v.ID, &v.TaskNo, &v.Name, &v.Status, &v.Progress, &v.Abnormal,
		&v.Deadline, &v.Remark, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}

func (s *Store) QueryCmdbInventoryTasks(status, keyword string, page, pageSize int) ([]CmdbInventoryTask, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	var where []string
	var args []interface{}
	if v := strings.TrimSpace(status); v != "" && v != "全部状态" {
		where = append(where, "status = ?")
		args = append(args, v)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(name LIKE ? OR IFNULL(task_no,'') LIKE ? OR IFNULL(remark,'') LIKE ?)`)
		args = append(args, pat, pat, pat)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM cmdb_inventory_tasks"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbInventorySelect+clause+" ORDER BY id DESC LIMIT ? OFFSET ?",
		append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
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

func (s *Store) CreateCmdbInventoryTask(v *CmdbInventoryTask) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	if strings.TrimSpace(v.Name) == "" {
		return 0, fmt.Errorf("任务名称不能为空")
	}
	if v.Status == "" {
		v.Status = "待执行"
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_inventory_tasks
		(task_no, name, status, progress, abnormal, deadline, remark, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		v.TaskNo, v.Name, v.Status, v.Progress, v.Abnormal, v.Deadline, v.Remark, now, now)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	// 同上：任务编号用自增 ID 保证唯一。
	if strings.TrimSpace(v.TaskNo) == "" {
		no := fmt.Sprintf("PD%s%04d", time.Now().Format("20060102"), id)
		if _, err := s.db.Exec(`UPDATE cmdb_inventory_tasks SET task_no=? WHERE id=?`, no, id); err != nil {
			return id, err
		}
		v.TaskNo = no
	}
	return id, nil
}

func (s *Store) UpdateCmdbInventoryTask(v *CmdbInventoryTask) error {
	if strings.TrimSpace(v.Name) == "" {
		return fmt.Errorf("任务名称不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE cmdb_inventory_tasks SET task_no=?, name=?, status=?, progress=?,
		abnormal=?, deadline=?, remark=?, updated_at=? WHERE id=?`,
		v.TaskNo, v.Name, v.Status, v.Progress, v.Abnormal, v.Deadline, v.Remark, now, v.ID)
	return err
}

func (s *Store) DeleteCmdbInventoryTask(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cmdb_inventory_tasks WHERE id=?`, id)
	return err
}

// ============================ 凭证中心 ============================

// CmdbCredential 仅登记凭证元信息，不存储明文口令。
type CmdbCredential struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	CredType    string `json:"cred_type"`
	Description string `json:"description"`
	AssetID     int64  `json:"asset_id"`
	AssetName   string `json:"asset_name"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const cmdbCredentialSelect = `SELECT c.id, c.name, IFNULL(c.cred_type,''), IFNULL(c.description,''),
	c.asset_id, IFNULL(a.name,''), IFNULL(c.created_at,''), IFNULL(c.updated_at,'')
	FROM cmdb_credentials c LEFT JOIN cmdb_assets a ON a.id = c.asset_id`

func scanCmdbCredential(sc interface{ Scan(...interface{}) error }) (CmdbCredential, error) {
	var v CmdbCredential
	err := sc.Scan(&v.ID, &v.Name, &v.CredType, &v.Description, &v.AssetID, &v.AssetName,
		&v.CreatedAt, &v.UpdatedAt)
	return v, err
}

func (s *Store) QueryCmdbCredentials(credType, keyword string, page, pageSize int) ([]CmdbCredential, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	var where []string
	var args []interface{}
	if v := strings.TrimSpace(credType); v != "" && v != "全部类型" {
		where = append(where, "c.cred_type = ?")
		args = append(args, v)
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, `(c.name LIKE ? OR IFNULL(c.description,'') LIKE ? OR IFNULL(c.cred_type,'') LIKE ?)`)
		args = append(args, pat, pat, pat)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM cmdb_credentials c" + clause
	if err := s.db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbCredentialSelect+clause+" ORDER BY c.id DESC LIMIT ? OFFSET ?",
		append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
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

func (s *Store) CreateCmdbCredential(v *CmdbCredential) (int64, error) {
	now := time.Now().Format("2006-01-02 15:04:05")
	if strings.TrimSpace(v.Name) == "" {
		return 0, fmt.Errorf("凭证名称不能为空")
	}
	res, err := s.db.Exec(`INSERT INTO cmdb_credentials
		(name, cred_type, description, asset_id, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
		v.Name, v.CredType, v.Description, v.AssetID, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) UpdateCmdbCredential(v *CmdbCredential) error {
	if strings.TrimSpace(v.Name) == "" {
		return fmt.Errorf("凭证名称不能为空")
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE cmdb_credentials SET name=?, cred_type=?, description=?, asset_id=?,
		updated_at=? WHERE id=?`, v.Name, v.CredType, v.Description, v.AssetID, now, v.ID)
	return err
}

func (s *Store) DeleteCmdbCredential(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cmdb_credentials WHERE id=?`, id)
	return err
}
