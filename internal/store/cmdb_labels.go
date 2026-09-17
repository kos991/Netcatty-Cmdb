package store

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

type CmdbLabel struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	SyncID     string `json:"sync_id"`
	Code       string `json:"code"`
	AssetID    int64  `json:"asset_id"`
	AssetName  string `json:"asset_name"`
	SN         string `json:"sn"`
	Department string `json:"department"`
	Owner      string `json:"owner"`
	AssetCode  string `json:"asset_code"`
	Status     string `json:"status"`
	Printed    int64  `json:"printed"`
	PrintBatch string `json:"print_batch"`
	CreatedAt  string `json:"created_at"`
}

const cmdbLabelSelect = `SELECT l.id,l.project_id,IFNULL(l.sync_id,''),l.code,l.asset_id,IFNULL(a.name,''),IFNULL(a.sn,''),
	IFNULL(a.department,''),IFNULL(a.owner,''),IFNULL(a.asset_code,''),
	CASE WHEN l.status='已归档' THEN '已归档' WHEN a.id IS NULL THEN '孤儿' ELSE '使用中' END,
	l.printed,IFNULL(l.print_batch,''),IFNULL(l.created_at,'')
	FROM cmdb_labels l LEFT JOIN cmdb_assets a ON a.id=l.asset_id AND a.project_id=l.project_id`

func scanCmdbLabel(row interface{ Scan(...interface{}) error }) (CmdbLabel, error) {
	var v CmdbLabel
	err := row.Scan(&v.ID, &v.ProjectID, &v.SyncID, &v.Code, &v.AssetID, &v.AssetName, &v.SN,
		&v.Department, &v.Owner, &v.AssetCode, &v.Status, &v.Printed, &v.PrintBatch, &v.CreatedAt)
	return v, err
}

func cmdbLabelTabPredicate(tab string) string {
	switch tab {
	case "使用中":
		return "l.status='使用中' AND a.id IS NOT NULL"
	case "孤儿":
		return "l.status<>'已归档' AND a.id IS NULL"
	case "已归档":
		return "l.status='已归档'"
	default:
		return ""
	}
}

func (s *Store) QueryCmdbLabels(tab, keyword string, page, pageSize int) ([]CmdbLabel, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.QueryCmdbLabelsForProject(scope, tab, keyword, page, pageSize)
}

func (s *Store) QueryCmdbLabelsForProject(scope ProjectScope, tab, keyword string, page, pageSize int) ([]CmdbLabel, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	where := []string{"l.project_id=?"}
	args := []interface{}{scope.ProjectID}
	if predicate := cmdbLabelTabPredicate(tab); predicate != "" {
		where = append(where, predicate)
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern := "%" + keyword + "%"
		where = append(where, `(l.code LIKE ? OR IFNULL(a.name,'') LIKE ? OR IFNULL(a.sn,'') LIKE ? OR IFNULL(a.department,'') LIKE ? OR IFNULL(a.owner,'') LIKE ? OR IFNULL(a.asset_code,'') LIKE ?)`)
		args = append(args, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	clause := " WHERE " + strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_labels l LEFT JOIN cmdb_assets a ON a.id=l.asset_id AND a.project_id=l.project_id`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbLabelSelect+clause+` ORDER BY l.id DESC LIMIT ? OFFSET ?`, append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := make([]CmdbLabel, 0, pageSize)
	for rows.Next() {
		item, err := scanCmdbLabel(rows)
		if err != nil {
			return nil, 0, err
		}
		list = append(list, item)
	}
	return list, total, rows.Err()
}

func (s *Store) QueryCmdbPrintedLabels(limit int) ([]CmdbLabel, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.QueryCmdbPrintedLabelsForProject(scope, limit)
}
func (s *Store) QueryCmdbPrintedLabelsForProject(scope ProjectScope, limit int) ([]CmdbLabel, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.Query(cmdbLabelSelect+` WHERE l.project_id=? AND l.printed=1 ORDER BY l.updated_at DESC,l.id DESC LIMIT ?`, scope.ProjectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CmdbLabel, 0, limit)
	for rows.Next() {
		item, err := scanCmdbLabel(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Store) CountOrphanCmdbLabels() (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CountOrphanCmdbLabelsForProject(scope)
}
func (s *Store) CountOrphanCmdbLabelsForProject(scope ProjectScope) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_labels l LEFT JOIN cmdb_assets a ON a.id=l.asset_id AND a.project_id=l.project_id WHERE l.project_id=? AND l.status<>'已归档' AND a.id IS NULL`, scope.ProjectID).Scan(&count)
	return count, err
}

func labelPrefixMetaKey(projectID int64) string {
	return fmt.Sprintf("cmdb_label_prefix:%d", projectID)
}
func (s *Store) LabelCodePrefix() (string, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return "ZC", err
	}
	return s.LabelCodePrefixForProject(scope)
}
func (s *Store) LabelCodePrefixForProject(scope ProjectScope) (string, error) {
	project, err := s.ResolveProject(scope)
	if err != nil {
		return "ZC", err
	}
	var value string
	err = s.db.QueryRow(`SELECT v FROM _meta WHERE k=?`, labelPrefixMetaKey(scope.ProjectID)).Scan(&value)
	if err == nil && strings.TrimSpace(value) != "" {
		return value, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "ZC", err
	}
	if project.Code == DefaultProjectCode {
		err = s.db.QueryRow(`SELECT v FROM _meta WHERE k='cmdb_label_prefix'`).Scan(&value)
		if err == nil && strings.TrimSpace(value) != "" {
			return value, nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "ZC", err
		}
	}
	return "ZC", nil
}
func (s *Store) SaveLabelCodePrefix(prefix string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.SaveLabelCodePrefixForProject(scope, prefix)
}
func (s *Store) SaveLabelCodePrefixForProject(scope ProjectScope, prefix string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO _meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, labelPrefixMetaKey(scope.ProjectID), prefix)
	return err
}

func (s *Store) GenerateCmdbLabels(prefix string) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.GenerateCmdbLabelsForProject(scope, prefix)
}
func (s *Store) GenerateCmdbLabelsForProject(scope ProjectScope, prefix string) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "ZC"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`INSERT OR IGNORE INTO cmdb_labels(project_id,code,asset_id,status,created_at,updated_at)
		SELECT a.project_id,CASE WHEN IFNULL(a.asset_code,'')<>'' THEN a.asset_code ELSE ?||'-'||a.id END,a.id,'使用中',?,?
		FROM cmdb_assets a WHERE a.project_id=? AND NOT EXISTS(SELECT 1 FROM cmdb_labels l WHERE l.project_id=a.project_id AND l.asset_id=a.id)`, prefix, now, now, scope.ProjectID)
	if err != nil {
		return 0, err
	}
	count, _ := res.RowsAffected()
	return int(count), nil
}

func (s *Store) RepairOrphanCmdbLabels() (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.RepairOrphanCmdbLabelsForProject(scope)
}
func (s *Store) RepairOrphanCmdbLabelsForProject(scope ProjectScope) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`UPDATE cmdb_labels SET asset_id=(SELECT a.id FROM cmdb_assets a WHERE a.project_id=? AND a.asset_code=cmdb_labels.code LIMIT 1),updated_at=?
		WHERE project_id=? AND (asset_id=0 OR asset_id NOT IN(SELECT id FROM cmdb_assets WHERE project_id=?)) AND EXISTS(SELECT 1 FROM cmdb_assets a WHERE a.project_id=? AND a.asset_code=cmdb_labels.code)`, scope.ProjectID, now, scope.ProjectID, scope.ProjectID, scope.ProjectID)
	if err != nil {
		return 0, err
	}
	linked, _ := res.RowsAffected()
	res, err = s.db.Exec(`UPDATE cmdb_labels SET status='已归档',updated_at=? WHERE project_id=? AND status<>'已归档' AND (asset_id=0 OR asset_id NOT IN(SELECT id FROM cmdb_assets WHERE project_id=?))`, now, scope.ProjectID, scope.ProjectID)
	if err != nil {
		return 0, err
	}
	archived, _ := res.RowsAffected()
	return int(linked + archived), nil
}

func (s *Store) SetCmdbLabelStatus(id int64, status string) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.SetCmdbLabelStatusForProject(scope, id, status)
}
func (s *Store) SetCmdbLabelStatusForProject(scope ProjectScope, id int64, status string) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`UPDATE cmdb_labels SET status=?,updated_at=? WHERE id=? AND project_id=?`, status, time.Now().Format("2006-01-02 15:04:05"), id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("标签不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}
func (s *Store) DeleteCmdbLabel(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeleteCmdbLabelForProject(scope, id)
}
func (s *Store) DeleteCmdbLabelForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM cmdb_labels WHERE id=? AND project_id=?`, id, scope.ProjectID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("标签不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	return nil
}

func (s *Store) MarkCmdbLabelsPrinted(ids []int64, batch string) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.MarkCmdbLabelsPrintedForProject(scope, ids, batch)
}
func (s *Store) MarkCmdbLabelsPrintedForProject(scope ProjectScope, ids []int64, batch string) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	holders := make([]string, len(ids))
	checkArgs := []interface{}{scope.ProjectID}
	for index, id := range ids {
		holders[index] = "?"
		checkArgs = append(checkArgs, id)
	}
	var owned int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_labels WHERE project_id=? AND id IN (`+strings.Join(holders, ",")+`)`, checkArgs...).Scan(&owned); err != nil {
		return 0, err
	}
	if owned != len(ids) {
		return 0, fmt.Errorf("批量标签包含不属于当前项目的记录: %w", ErrProjectScopedNotFound)
	}
	args := []interface{}{1, batch, time.Now().Format("2006-01-02 15:04:05"), scope.ProjectID}
	args = append(args, checkArgs[1:]...)
	res, err := s.db.Exec(`UPDATE cmdb_labels SET printed=?,print_batch=?,updated_at=? WHERE project_id=? AND id IN (`+strings.Join(holders, ",")+`)`, args...)
	if err != nil {
		return 0, err
	}
	count, _ := res.RowsAffected()
	return int(count), nil
}

type CmdbCountItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func (s *Store) CmdbDashboardData() (map[string]interface{}, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.CmdbDashboardDataForProject(scope)
}
func (s *Store) CmdbDashboardDataForProject(scope ProjectScope) (map[string]interface{}, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	out := map[string]interface{}{}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets WHERE project_id=?`, scope.ProjectID).Scan(&total); err != nil {
		return nil, err
	}
	out["total"] = total
	statusCounts := map[string]int{}
	rows, err := s.db.Query(`SELECT IFNULL(status,''),COUNT(*) FROM cmdb_assets WHERE project_id=? GROUP BY status`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err != nil {
			rows.Close()
			return nil, err
		}
		statusCounts[name] = count
	}
	rows.Close()
	out["status_counts"] = statusCounts
	online := statusCounts["在线"]
	attention := statusCounts["离线"] + statusCounts["故障"] + statusCounts["维护中"]
	healthRate, attentionRate := 0.0, 0.0
	if total > 0 {
		healthRate = math.Round(float64(online)/float64(total)*1000) / 10
		attentionRate = math.Round(float64(attention)/float64(total)*1000) / 10
	}
	out["health_rate"], out["attention_rate"], out["attention_count"] = healthRate, attentionRate, attention
	recent, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Page: 1, PageSize: 5, SortOrder: "desc"})
	if err != nil {
		return nil, err
	}
	out["recent_assets"] = recent
	collect := func(query string, args ...interface{}) ([]CmdbCountItem, error) {
		result := []CmdbCountItem{}
		rows, err := s.db.Query(query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var item CmdbCountItem
			if err := rows.Scan(&item.Name, &item.Count); err != nil {
				return nil, err
			}
			result = append(result, item)
		}
		return result, rows.Err()
	}
	geo, err := collect(`SELECT CASE WHEN IFNULL(province,'')<>'' THEN province ELSE city END,COUNT(*) FROM cmdb_assets WHERE project_id=? AND (IFNULL(province,'')<>'' OR IFNULL(city,'')<>'') GROUP BY 1 ORDER BY COUNT(*) DESC`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	out["geo_dist"] = geo
	categories, err := collect(`SELECT CASE WHEN IFNULL(c.name,'')='' THEN '未分类' ELSE c.name END,COUNT(*) FROM cmdb_assets a LEFT JOIN cmdb_device_categories c ON c.id=a.category_id AND c.project_id=a.project_id WHERE a.project_id=? GROUP BY 1 ORDER BY COUNT(*) DESC`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	out["category_dist"] = categories
	departments, err := collect(`SELECT CASE WHEN IFNULL(department,'')='' THEN '未分配部门' ELSE department END,COUNT(*) FROM cmdb_assets WHERE project_id=? GROUP BY 1 ORDER BY COUNT(*) DESC`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	out["department_dist"] = departments
	abnormal, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Status: "离线", Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	faults, _, err := s.QueryCmdbAssetsForProject(scope, CmdbAssetQuery{Status: "故障", Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	out["abnormal_devices"] = append(abnormal, faults...)
	var expiring int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets WHERE project_id=? AND IFNULL(warranty_date,'')<>'' AND warranty_date>=date('now') AND warranty_date<=date('now','+90 day')`, scope.ProjectID).Scan(&expiring); err != nil {
		return nil, err
	}
	out["expiring_count"] = expiring
	orders, orderTotal, err := s.QueryCmdbWorkOrdersForProject(scope, CmdbWorkOrderQuery{Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	out["recent_work_orders"], out["work_order_total"] = orders, orderTotal
	return out, nil
}
