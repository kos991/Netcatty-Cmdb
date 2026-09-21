package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Person 对应 cmdb_persons 表。
type Person struct {
	ID           int64  `json:"id"`
	ProjectID    int64  `json:"project_id"`
	SyncID       string `json:"sync_id"`
	OrgID        int64  `json:"org_id"`
	DepartmentID int64  `json:"department_id"`
	GroupID      int64  `json:"group_id"`
	PersonCode   string `json:"person_code"`
	Name         string `json:"name"`
	OrgName      string `json:"org_name"`
	GroupName    string `json:"group_name"`
	Department   string `json:"department"`
	Title        string `json:"title"`
	Phone        string `json:"phone"`
	Email        string `json:"email"`
	Status       string `json:"status"` // 在职 / 离职 / 调休
	Remark       string `json:"remark"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	AssetCount   int    `json:"asset_count"` // 穿透计算名下资产数量
}

// PersonQuery 人员列表筛选参数。
type PersonQuery struct {
	Keyword    string
	Department string
	OrgName    string
	GroupName  string
	Status     string
	Page       int
	PageSize   int
}

// PersonTransferReq 人员资产一键交接请求。
type PersonTransferReq struct {
	FromPersonID int64   `json:"from_person_id"`
	ToPersonID   int64   `json:"to_person_id"`
	AssetIDs     []int64 `json:"asset_ids,omitempty"`
	Operator     string  `json:"operator"`
	Remark       string  `json:"remark"`
}

// ListPersons 分页查询人员列表，并统计名下资产数量。
func (s *Store) ListPersons(q PersonQuery) ([]Person, int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, 0, err
	}
	return s.ListPersonsForProject(scope, q)
}

func (s *Store) ListPersonsForProject(scope ProjectScope, q PersonQuery) ([]Person, int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, 0, err
	}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 || q.PageSize > 500 {
		q.PageSize = 20
	}

	where := []string{"p.project_id = ?"}
	args := []interface{}{scope.ProjectID}

	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		pat := "%" + kw + "%"
		where = append(where, "(p.name LIKE ? OR IFNULL(p.person_code,'') LIKE ? OR IFNULL(p.phone,'') LIKE ? OR IFNULL(p.email,'') LIKE ?)")
		args = append(args, pat, pat, pat, pat)
	}
	if dept := strings.TrimSpace(q.Department); dept != "" && dept != "全部" {
		where = append(where, "COALESCE(NULLIF(d.name,''), p.department) = ?")
		args = append(args, dept)
	}
	if org := strings.TrimSpace(q.OrgName); org != "" && org != "全部" {
		where = append(where, "COALESCE(NULLIF(o.name,''), p.org_name) = ?")
		args = append(args, org)
	}
	if grp := strings.TrimSpace(q.GroupName); grp != "" && grp != "全部" {
		where = append(where, "COALESCE(NULLIF(g.name,''), p.group_name) = ?")
		args = append(args, grp)
	}
	if st := strings.TrimSpace(q.Status); st != "" && st != "全部" {
		where = append(where, "p.status = ?")
		args = append(args, st)
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	personFrom := ` FROM cmdb_persons p
		LEFT JOIN cmdb_org_nodes o ON o.id=p.org_id AND o.project_id=p.project_id AND o.deleted_at IS NULL
		LEFT JOIN cmdb_org_nodes d ON d.id=p.department_id AND d.project_id=p.project_id AND d.deleted_at IS NULL
		LEFT JOIN cmdb_org_nodes g ON g.id=p.group_id AND g.project_id=p.project_id AND g.deleted_at IS NULL`
	countQuery := "SELECT COUNT(*)" + personFrom + whereClause
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (q.Page - 1) * q.PageSize
	query := fmt.Sprintf(`
		SELECT p.id, p.project_id, IFNULL(p.sync_id,''), p.org_id, p.department_id, p.group_id,
		       IFNULL(p.person_code,''), p.name,
		       COALESCE(NULLIF(o.name,''), IFNULL(p.org_name,'')),
		       COALESCE(NULLIF(g.name,''), IFNULL(p.group_name,'')),
		       COALESCE(NULLIF(d.name,''), p.department), IFNULL(p.title,''), IFNULL(p.phone,''), IFNULL(p.email,''),
		       p.status, IFNULL(p.remark,''), IFNULL(p.created_at,''), IFNULL(p.updated_at,''),
		       ((SELECT COUNT(*) FROM cmdb_assets a
		         WHERE a.project_id = p.project_id
		           AND a.source_type <> 'legacy_asset'
		           AND (a.owner_id = p.id OR (a.owner_id = 0 AND a.owner = p.name)))
		        +
		        (SELECT COUNT(*) FROM assets la
		         WHERE la.project_id = p.project_id
		           AND TRIM(IFNULL(la.user_name,'')) = TRIM(p.name))) AS asset_count
		%s
		%s
		ORDER BY p.id DESC
		LIMIT ? OFFSET ?`, personFrom, whereClause)

	queryArgs := append(append([]interface{}{}, args...), q.PageSize, offset)
	rows, err := s.db.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	list := make([]Person, 0, q.PageSize)
	for rows.Next() {
		var p Person
		if err := rows.Scan(
			&p.ID, &p.ProjectID, &p.SyncID, &p.OrgID, &p.DepartmentID, &p.GroupID,
			&p.PersonCode, &p.Name, &p.OrgName, &p.GroupName,
			&p.Department, &p.Title, &p.Phone, &p.Email,
			&p.Status, &p.Remark, &p.CreatedAt, &p.UpdatedAt,
			&p.AssetCount,
		); err != nil {
			return nil, 0, err
		}
		list = append(list, p)
	}

	return list, total, rows.Err()
}

// GetPerson 读取单个人员信息。
func (s *Store) GetPerson(id int64) (*Person, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.GetPersonForProject(scope, id)
}

func (s *Store) GetPersonForProject(scope ProjectScope, id int64) (*Person, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var p Person
	query := `
		SELECT p.id, p.project_id, IFNULL(p.sync_id,''), p.org_id, p.department_id, p.group_id,
		       IFNULL(p.person_code,''), p.name,
		       COALESCE(NULLIF(o.name,''), IFNULL(p.org_name,'')),
		       COALESCE(NULLIF(g.name,''), IFNULL(p.group_name,'')),
		       COALESCE(NULLIF(d.name,''), p.department), IFNULL(p.title,''), IFNULL(p.phone,''), IFNULL(p.email,''),
		       p.status, IFNULL(p.remark,''), IFNULL(p.created_at,''), IFNULL(p.updated_at,''),
		       ((SELECT COUNT(*) FROM cmdb_assets a
		         WHERE a.project_id = p.project_id
		           AND a.source_type <> 'legacy_asset'
		           AND (a.owner_id = p.id OR (a.owner_id = 0 AND a.owner = p.name)))
		        +
		        (SELECT COUNT(*) FROM assets la
		         WHERE la.project_id = p.project_id
		           AND TRIM(IFNULL(la.user_name,'')) = TRIM(p.name))) AS asset_count
		FROM cmdb_persons p
		LEFT JOIN cmdb_org_nodes o ON o.id=p.org_id AND o.project_id=p.project_id AND o.deleted_at IS NULL
		LEFT JOIN cmdb_org_nodes d ON d.id=p.department_id AND d.project_id=p.project_id AND d.deleted_at IS NULL
		LEFT JOIN cmdb_org_nodes g ON g.id=p.group_id AND g.project_id=p.project_id AND g.deleted_at IS NULL
		WHERE p.id = ? AND p.project_id = ?`

	err := s.db.QueryRow(query, id, scope.ProjectID).Scan(
		&p.ID, &p.ProjectID, &p.SyncID, &p.OrgID, &p.DepartmentID, &p.GroupID,
		&p.PersonCode, &p.Name, &p.OrgName, &p.GroupName,
		&p.Department, &p.Title, &p.Phone, &p.Email,
		&p.Status, &p.Remark, &p.CreatedAt, &p.UpdatedAt,
		&p.AssetCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.Join(ErrProjectScopedNotFound, sql.ErrNoRows)
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePerson 创建新人员。
func (s *Store) CreatePerson(p *Person) (int64, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.CreatePersonForProject(scope, p)
}

func (s *Store) CreatePersonForProject(scope ProjectScope, p *Person) (int64, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return 0, fmt.Errorf("人员姓名不能为空")
	}
	if err := s.resolvePersonOrgPath(scope, p); err != nil {
		return 0, err
	}
	if p.Status == "" {
		p.Status = "在职"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	p.CreatedAt = now
	p.UpdatedAt = now

	res, err := s.db.Exec(`
		INSERT INTO cmdb_persons (project_id, org_id, department_id, group_id, person_code, name, org_name, group_name, department, title, phone, email, status, remark, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		scope.ProjectID, p.OrgID, p.DepartmentID, p.GroupID, p.PersonCode, p.Name, p.OrgName, p.GroupName, p.Department, p.Title, p.Phone, p.Email, p.Status, p.Remark, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil {
		return 0, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	p.ID = newID
	p.ProjectID = scope.ProjectID
	if err := s.db.QueryRow("SELECT sync_id FROM cmdb_persons WHERE id = ? AND project_id = ?", newID, scope.ProjectID).Scan(&p.SyncID); err != nil {
		return 0, err
	}
	return newID, nil
}

// UpdatePerson 更新人员信息。
func (s *Store) UpdatePerson(p *Person) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.UpdatePersonForProject(scope, p)
}

func (s *Store) UpdatePersonForProject(scope ProjectScope, p *Person) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return fmt.Errorf("人员姓名不能为空")
	}
	if err := s.resolvePersonOrgPath(scope, p); err != nil {
		return err
	}
	if p.Status == "" {
		p.Status = "在职"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	p.UpdatedAt = now

	res, err := s.db.Exec(`
		UPDATE cmdb_persons
		SET org_id=?, department_id=?, group_id=?, person_code = ?, name = ?, org_name = ?, group_name = ?, department = ?, title = ?, phone = ?, email = ?, status = ?, remark = ?, updated_at = ?
		WHERE id = ? AND project_id = ?`,
		p.OrgID, p.DepartmentID, p.GroupID, p.PersonCode, p.Name, p.OrgName, p.GroupName, p.Department, p.Title, p.Phone, p.Email, p.Status, p.Remark, p.UpdatedAt, p.ID, scope.ProjectID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("人员不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	p.ProjectID = scope.ProjectID
	return nil
}

// DeletePerson 删除人员。
func (s *Store) DeletePerson(id int64) error {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return err
	}
	return s.DeletePersonForProject(scope, id)
}

func (s *Store) DeletePersonForProject(scope ProjectScope, id int64) error {
	if _, err := s.ResolveProject(scope); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec("DELETE FROM cmdb_persons WHERE id = ? AND project_id = ?", id, scope.ProjectID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("人员不属于当前项目: %w", ErrProjectScopedNotFound)
	}
	// 将名下绑定了该 owner_id 的资产解除 owner_id 绑定（保留 owner 姓名字符串）
	if _, err := tx.Exec("UPDATE cmdb_assets SET owner_id = 0 WHERE owner_id = ? AND project_id = ?", id, scope.ProjectID); err != nil {
		return err
	}
	return tx.Commit()
}

// GetPersonAssets 穿透查询指定人员名下的所有资产（PC、服务器、虚拟机等）。
func (s *Store) GetPersonAssets(personID int64) (*Person, []CmdbAsset, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, nil, err
	}
	return s.GetPersonAssetsForProject(scope, personID)
}

func (s *Store) GetPersonAssetsForProject(scope ProjectScope, personID int64) (*Person, []CmdbAsset, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, nil, err
	}
	person, err := s.GetPersonForProject(scope, personID)
	if err != nil {
		return nil, nil, fmt.Errorf("人员不存在: %w", err)
	}

	query := cmdbAssetSelect + " WHERE a.project_id = ? AND a.source_type <> 'legacy_asset' AND (a.owner_id = ? OR (a.owner_id = 0 AND a.owner = ?)) ORDER BY a.id DESC"
	rows, err := s.db.Query(query, scope.ProjectID, person.ID, person.Name)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var assets []CmdbAsset
	for rows.Next() {
		asset, err := scanCmdbAsset(rows)
		if err != nil {
			return nil, nil, err
		}
		assets = append(assets, asset)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	rows.Close()

	legacyRows, err := s.db.Query(`
		SELECT la.id, la.project_id, IFNULL(la.asset_code,''), IFNULL(la.device_type,''),
		       IFNULL(la.box_sn,''), IFNULL(la.display_sn,''), IFNULL(la.user_name,''),
		       IFNULL(la.department,''), IFNULL(la.room,''), IFNULL(la.ip,''),
		       IFNULL(la.terminal_ip,''), IFNULL(la.security_software,''), IFNULL(la.status,''),
		       IFNULL(la.net_type,''), IFNULL(la.remark,''), IFNULL(la.created_at,''),
		       IFNULL(la.updated_at,''), IFNULL(mapped.id,0)
		FROM assets la
		LEFT JOIN cmdb_assets mapped
		  ON mapped.project_id = la.project_id
		 AND mapped.source_type = 'legacy_asset'
		 AND mapped.source_id = la.id
		 AND mapped.deleted_at IS NULL
		WHERE la.project_id = ? AND TRIM(IFNULL(la.user_name,'')) = TRIM(?)
		ORDER BY la.id DESC`, scope.ProjectID, person.Name)
	if err != nil {
		return nil, nil, err
	}
	defer legacyRows.Close()
	for legacyRows.Next() {
		var legacyID, mappedID int64
		var asset CmdbAsset
		if err := legacyRows.Scan(
			&legacyID, &asset.ProjectID, &asset.AssetCode, &asset.DeviceType,
			&asset.BoxSN, &asset.DisplaySN, &asset.Owner,
			&asset.Department, &asset.Room, &asset.ManageIP,
			&asset.MgmtIP, &asset.SecuritySoftware, &asset.Status,
			&asset.NetType, &asset.Remark, &asset.CreatedAt,
			&asset.UpdatedAt, &mappedID,
		); err != nil {
			return nil, nil, err
		}
		asset.ID = mappedID
		if asset.ID == 0 {
			asset.ID = -legacyID
		}
		asset.SourceType = "legacy_asset"
		asset.SourceID = legacyID
		asset.AssetClass = "terminal"
		asset.SN = asset.BoxSN
		asset.Name = asset.AssetCode
		if asset.Name == "" {
			asset.Name = asset.DeviceType
		}
		if asset.Name == "" {
			asset.Name = "终端资产"
		}
		if asset.ManageIP != "" {
			asset.Interfaces = []CmdbAssetInterface{{AssetID: asset.ID, Name: "设备 IP", IP: asset.ManageIP, IsPrimary: 1, NetworkZone: asset.NetType, NetZone: asset.NetType}}
		}
		assets = append(assets, asset)
	}
	if err := legacyRows.Err(); err != nil {
		return nil, nil, err
	}

	for i := range assets {
		if assets[i].SourceType == "legacy_asset" {
			continue
		}
		ifaces, err := s.getAssetInterfacesForProject(scope, assets[i].ID)
		if err != nil {
			return nil, nil, err
		}
		assets[i].Interfaces = ifaces
	}
	if assets == nil {
		assets = []CmdbAsset{}
	}
	person.AssetCount = len(assets)
	return person, assets, nil
}

// TransferPersonAssets 一键批量交接人员名下的资产到新人员。
func (s *Store) TransferPersonAssets(req PersonTransferReq) (int, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return 0, err
	}
	return s.TransferPersonAssetsForProject(scope, req)
}

func (s *Store) TransferPersonAssetsForProject(scope ProjectScope, req PersonTransferReq) (int, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return 0, err
	}
	if req.FromPersonID <= 0 || req.ToPersonID <= 0 {
		return 0, fmt.Errorf("必须指定移交人与接收人")
	}
	if req.FromPersonID == req.ToPersonID {
		return 0, fmt.Errorf("移交人与接收人不能为同一人")
	}

	fromPerson, err := s.GetPersonForProject(scope, req.FromPersonID)
	if err != nil {
		return 0, fmt.Errorf("移交人不存在: %w", err)
	}
	toPerson, err := s.GetPersonForProject(scope, req.ToPersonID)
	if err != nil {
		return 0, fmt.Errorf("接收人不存在: %w", err)
	}

	operator := req.Operator
	if strings.TrimSpace(operator) == "" {
		operator = "资产管理员"
	}
	remark := req.Remark
	if strings.TrimSpace(remark) == "" {
		remark = fmt.Sprintf("人员资产一键交接：从 [%s] 转交至 [%s]", fromPerson.Name, toPerson.Name)
	}

	// 确定待交接资产
	var targetIDs []int64
	if len(req.AssetIDs) > 0 {
		for _, id := range req.AssetIDs {
			targetIDs = append(targetIDs, id)
		}
	} else {
		// 原生 CMDB 资产直接取 ID；终端台账优先复用映射 ID，未映射记录以负 ID 区分。
		rows, err := s.db.Query("SELECT id FROM cmdb_assets WHERE project_id = ? AND source_type <> 'legacy_asset' AND (owner_id = ? OR (owner_id = 0 AND owner = ?))", scope.ProjectID, fromPerson.ID, fromPerson.Name)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return 0, err
			}
			targetIDs = append(targetIDs, id)
		}
		rows.Close()
		legacyRows, err := s.db.Query(`
			SELECT CASE WHEN mapped.id IS NULL THEN -la.id ELSE mapped.id END
			FROM assets la
			LEFT JOIN cmdb_assets mapped
			  ON mapped.project_id=la.project_id AND mapped.source_type='legacy_asset'
			 AND mapped.source_id=la.id AND mapped.deleted_at IS NULL
			WHERE la.project_id=? AND TRIM(IFNULL(la.user_name,''))=TRIM(?)`, scope.ProjectID, fromPerson.Name)
		if err != nil {
			return 0, err
		}
		for legacyRows.Next() {
			var id int64
			if err := legacyRows.Scan(&id); err != nil {
				legacyRows.Close()
				return 0, err
			}
			targetIDs = append(targetIDs, id)
		}
		if err := legacyRows.Err(); err != nil {
			legacyRows.Close()
			return 0, err
		}
		legacyRows.Close()
	}

	if len(targetIDs) == 0 {
		return 0, nil
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	transferredCount := 0
	for _, assetID := range targetIDs {
		if assetID < 0 {
			legacyID := -assetID
			var oldOwner, oldDept, oldRoom string
			err := tx.QueryRow(`SELECT IFNULL(user_name,''), IFNULL(department,''), IFNULL(room,'')
				FROM assets WHERE id=? AND project_id=?`, legacyID, scope.ProjectID).Scan(&oldOwner, &oldDept, &oldRoom)
			if errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("终端资产 %d 不属于当前项目: %w", legacyID, ErrProjectScopedNotFound)
			}
			if err != nil {
				return 0, err
			}
			if strings.TrimSpace(oldOwner) != strings.TrimSpace(fromPerson.Name) {
				return 0, fmt.Errorf("终端资产 %d 已不属于 %s", legacyID, fromPerson.Name)
			}
			if _, err := tx.Exec(`UPDATE assets SET user_name=?, department=?, updated_at=? WHERE id=? AND project_id=?`,
				toPerson.Name, toPerson.Department, now, legacyID, scope.ProjectID); err != nil {
				return 0, err
			}
			if _, err := tx.Exec(`
				INSERT INTO asset_logs(project_id, asset_id, log_type, from_user, to_user, from_location, to_location, old_sn, new_sn, operator, description, log_time)
				VALUES(?, ?, '调换使用人', ?, ?, ?, ?, '', '', ?, ?, ?)`,
				scope.ProjectID, legacyID, oldOwner, toPerson.Name, strings.TrimSpace(oldDept+" "+oldRoom), strings.TrimSpace(toPerson.Department), operator, remark, now,
			); err != nil {
				return 0, err
			}
			transferredCount++
			continue
		}
		var oldOwner, oldDept, oldRoom, boxSN, srcType string
		var srcID int64
		assetRelations := &CmdbAsset{ID: assetID}
		err := tx.QueryRow(`
			SELECT IFNULL(owner,''), IFNULL(department,''), IFNULL(room,''), IFNULL(box_sn,''), IFNULL(source_type,'manual'), IFNULL(source_id,0),
			       category_id, model_id, org_id, group_id, owner_id
			FROM cmdb_assets WHERE id = ? AND project_id = ?`, assetID, scope.ProjectID).Scan(
			&oldOwner, &oldDept, &oldRoom, &boxSN, &srcType, &srcID,
			&assetRelations.CategoryID, &assetRelations.ModelID, &assetRelations.OrgID, &assetRelations.GroupID, &assetRelations.OwnerID,
		)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("资产 %d 不属于当前项目: %w", assetID, ErrProjectScopedNotFound)
		}
		if err != nil {
			return 0, err
		}
		if err := validateCmdbAssetRelations(tx, scope.ProjectID, assetRelations); err != nil {
			return 0, err
		}

		// 更新 cmdb_assets
		_, err = tx.Exec(`
			UPDATE cmdb_assets
			SET owner_id = ?, owner = ?, department = ?, organization = ?, updated_at = ?
			WHERE id = ? AND project_id = ?`,
			toPerson.ID, toPerson.Name, toPerson.Department, toPerson.OrgName, now, assetID, scope.ProjectID,
		)
		if err != nil {
			return 0, err
		}

		// 记录 asset_logs
		fromLoc := strings.TrimSpace(oldDept + " " + oldRoom)
		toLoc := strings.TrimSpace(toPerson.Department)
		if _, err := tx.Exec(`
			INSERT INTO asset_logs(project_id, asset_id, log_type, from_user, to_user, from_location, to_location, old_sn, new_sn, operator, description, log_time)
			VALUES(?, ?, '调换使用人', ?, ?, ?, ?, '', '', ?, ?, ?)`,
			scope.ProjectID, assetID, oldOwner, toPerson.Name, fromLoc, toLoc, operator, remark, now,
		); err != nil {
			return 0, err
		}

		// 同步写穿到旧源台账
		if srcID > 0 {
			if srcType == "legacy_asset" {
				if _, err := tx.Exec("UPDATE assets SET user_name = ?, department = ?, updated_at = ? WHERE id = ? AND project_id = ?",
					toPerson.Name, toPerson.Department, now, srcID, scope.ProjectID); err != nil {
					return 0, err
				}
			} else if srcType == "legacy_server" {
				if _, err := tx.Exec("UPDATE servers SET admin_user = ?, updated_at = ? WHERE id = ? AND project_id = ?",
					toPerson.Name, now, srcID, scope.ProjectID); err != nil {
					return 0, err
				}
			}
		}

		transferredCount++
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return transferredCount, nil
}

// getAssetInterfaces 辅助读取资产的网卡接口。
func (s *Store) getAssetInterfaces(assetID int64) ([]CmdbAssetInterface, error) {
	scope, err := s.DefaultProjectScope()
	if err != nil {
		return nil, err
	}
	return s.getAssetInterfacesForProject(scope, assetID)
}

func (s *Store) getAssetInterfacesForProject(scope ProjectScope, assetID int64) ([]CmdbAssetInterface, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT id, asset_id, IFNULL(asset_name,''), IFNULL(name,''), IFNULL(if_name,''),
		       IFNULL(ip,''), IFNULL(mask,''), IFNULL(gateway,''), IFNULL(mac,''),
		       IFNULL(network_zone,''), IFNULL(net_zone,''), is_primary, vlan_id, IFNULL(remark,'')
		FROM cmdb_asset_interfaces i
		WHERE i.asset_id = ? AND i.project_id = ?
		  AND EXISTS (SELECT 1 FROM cmdb_assets a WHERE a.id = i.asset_id AND a.project_id = ?)
		ORDER BY is_primary DESC, id ASC`, assetID, scope.ProjectID, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ifaces []CmdbAssetInterface
	for rows.Next() {
		var it CmdbAssetInterface
		if err := rows.Scan(
			&it.ID, &it.AssetID, &it.AssetName, &it.Name, &it.IfName,
			&it.IP, &it.Mask, &it.Gateway, &it.MAC,
			&it.NetworkZone, &it.NetZone, &it.IsPrimary, &it.VlanID, &it.Remark,
		); err != nil {
			return nil, err
		}
		if it.Name == "" && it.IfName != "" {
			it.Name = it.IfName
		}
		if it.IfName == "" && it.Name != "" {
			it.IfName = it.Name
		}
		if it.NetworkZone == "" && it.NetZone != "" {
			it.NetworkZone = it.NetZone
		}
		if it.NetZone == "" && it.NetworkZone != "" {
			it.NetZone = it.NetworkZone
		}
		ifaces = append(ifaces, it)
	}
	if ifaces == nil {
		ifaces = []CmdbAssetInterface{}
	}
	return ifaces, rows.Err()
}
