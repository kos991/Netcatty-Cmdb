package store

import (
	"strings"
)

// ============================ 工单管理 ============================

type CmdbWorkOrder struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	SyncID     string `json:"sync_id"`
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

const cmdbWorkOrderSelect = `SELECT id, project_id, IFNULL(sync_id,''), IFNULL(order_no,''), IFNULL(priority,''), subject,
	IFNULL(biz_type,''), IFNULL(status,''), IFNULL(plan_time,''), IFNULL(actual_time,''),
	IFNULL(result,''), IFNULL(owner,''), IFNULL(maintainer,''), asset_id, IFNULL(remark,''),
	IFNULL(created_at,''), IFNULL(updated_at,'') FROM cmdb_work_orders`

func scanCmdbWorkOrder(sc interface{ Scan(...interface{}) error }) (CmdbWorkOrder, error) {
	var w CmdbWorkOrder
	err := sc.Scan(&w.ID, &w.ProjectID, &w.SyncID, &w.OrderNo, &w.Priority, &w.Subject, &w.BizType, &w.Status,
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
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbWorkOrdersForProject(scope, q)
}

func (s *Store) GetCmdbWorkOrder(id int64) (*CmdbWorkOrder, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetCmdbWorkOrderForProject(scope, id)
}

func (s *Store) CreateCmdbWorkOrder(w *CmdbWorkOrder) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbWorkOrderForProject(scope, w)
}

func (s *Store) UpdateCmdbWorkOrder(w *CmdbWorkOrder) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbWorkOrderForProject(scope, w)
}

func (s *Store) DeleteCmdbWorkOrder(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbWorkOrderForProject(scope, id)
}

func (s *Store) CountCmdbWorkOrders() (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CountCmdbWorkOrdersForProject(scope)
}

// ============================ 资产盘点 ============================

type CmdbInventoryTask struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SyncID    string `json:"sync_id"`
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

const cmdbInventorySelect = `SELECT id, project_id, IFNULL(sync_id,''), IFNULL(task_no,''), name, IFNULL(status,''), progress,
	abnormal, IFNULL(deadline,''), IFNULL(remark,''), IFNULL(created_at,''), IFNULL(updated_at,'')
	FROM cmdb_inventory_tasks`

func scanCmdbInventory(sc interface{ Scan(...interface{}) error }) (CmdbInventoryTask, error) {
	var v CmdbInventoryTask
	err := sc.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.TaskNo, &v.Name, &v.Status, &v.Progress, &v.Abnormal,
		&v.Deadline, &v.Remark, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}

func (s *Store) QueryCmdbInventoryTasks(status, keyword string, page, pageSize int) ([]CmdbInventoryTask, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbInventoryTasksForProject(scope, status, keyword, page, pageSize)
}

func (s *Store) CreateCmdbInventoryTask(v *CmdbInventoryTask) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbInventoryTaskForProject(scope, v)
}

func (s *Store) UpdateCmdbInventoryTask(v *CmdbInventoryTask) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbInventoryTaskForProject(scope, v)
}

func (s *Store) DeleteCmdbInventoryTask(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbInventoryTaskForProject(scope, id)
}

// ============================ 凭证中心 ============================

// CmdbCredential 仅登记凭证元信息，不存储明文口令。
type CmdbCredential struct {
	ID          int64  `json:"id"`
	ProjectID   int64  `json:"project_id"`
	SyncID      string `json:"sync_id"`
	Name        string `json:"name"`
	CredType    string `json:"cred_type"`
	Description string `json:"description"`
	AssetID     int64  `json:"asset_id"`
	AssetName   string `json:"asset_name"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

const cmdbCredentialSelect = `SELECT c.id, c.project_id, IFNULL(c.sync_id,''), c.name, IFNULL(c.cred_type,''), IFNULL(c.description,''),
	c.asset_id, IFNULL(a.name,''), IFNULL(c.created_at,''), IFNULL(c.updated_at,'')
	FROM cmdb_credentials c LEFT JOIN cmdb_assets a ON a.id = c.asset_id AND a.project_id = c.project_id`

func scanCmdbCredential(sc interface{ Scan(...interface{}) error }) (CmdbCredential, error) {
	var v CmdbCredential
	err := sc.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Name, &v.CredType, &v.Description, &v.AssetID, &v.AssetName,
		&v.CreatedAt, &v.UpdatedAt)
	return v, err
}

func (s *Store) QueryCmdbCredentials(credType, keyword string, page, pageSize int) ([]CmdbCredential, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbCredentialsForProject(scope, credType, keyword, page, pageSize)
}

func (s *Store) CreateCmdbCredential(v *CmdbCredential) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreateCmdbCredentialForProject(scope, v)
}

func (s *Store) UpdateCmdbCredential(v *CmdbCredential) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdateCmdbCredentialForProject(scope, v)
}

func (s *Store) DeleteCmdbCredential(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbCredentialForProject(scope, id)
}
