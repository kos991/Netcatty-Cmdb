#[derive(Clone, Debug)]
pub struct TerminalAsset {
    pub id: u64,
    pub name: &'static str,
    pub box_sn: &'static str,
    pub code: &'static str,
    pub device_type: &'static str,
    pub brand: &'static str,
    pub model: &'static str,
    pub user: &'static str,
    pub dept: &'static str,
    pub room: &'static str,
    pub ip: &'static str,
    pub net_type: &'static str,
    pub status: &'static str,
    pub cpu: &'static str,
    pub memory: &'static str,
    pub disk: &'static str,
}

pub fn sample_terminals() -> Vec<TerminalAsset> {
    vec![
        TerminalAsset { id: 1, name: "示例云桌面 01", box_sn: "BOX-202610-001", code: "ZCY-DZ-202610-001", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "张伟", dept: "信息技术部", room: "401", ip: "10.20.30.21", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 2, name: "示例云桌面 02", box_sn: "BOX-202610-002", code: "ZCY-DZ-202610-002", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "李娜", dept: "民事审判一庭", room: "302", ip: "10.20.30.22", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 3, name: "示例台式机 03", box_sn: "SN-DELL-882141", code: "ZCY-DZ-202610-003", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 7410", user: "王强", dept: "立案庭", room: "105", ip: "192.168.10.31", net_type: "内网", status: "使用中", cpu: "1 × Intel Core i5-12500", memory: "16384 MB", disk: "512 GB NVMe" },
        TerminalAsset { id: 4, name: "示例笔记本 04", box_sn: "SN-LENOVO-55421", code: "ZCY-DZ-202610-004", device_type: "笔记本", brand: "联想 Lenovo", model: "ThinkPad T14", user: "赵敏", dept: "综合办公室", room: "508", ip: "192.168.10.32", net_type: "内网", status: "使用中", cpu: "1 × AMD Ryzen 7 PRO", memory: "16384 MB", disk: "512 GB SSD" },
        TerminalAsset { id: 5, name: "示例网络打印机 05", box_sn: "SN-PANTUM-99120", code: "ZCY-DZ-202610-005", device_type: "打印机", brand: "奔图 PANTUM", model: "P2500", user: "民事二庭公用", dept: "民事审判二庭", room: "305", ip: "192.168.10.40", net_type: "内网", status: "使用中", cpu: "内置控制器", memory: "256 MB", disk: "无" },
        TerminalAsset { id: 6, name: "示例备用台式机 06", box_sn: "SN-DELL-114299", code: "ZCY-DZ-202610-006", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 7090", user: "未分配", dept: "信息保障库房", room: "102", ip: "192.168.10.55", net_type: "内网", status: "闲置", cpu: "1 × Intel Core i5-11500", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 7, name: "示例故障云盒 07", box_sn: "BOX-202610-007", code: "ZCY-DZ-202610-007", device_type: "云桌面盒子", brand: "华为 Huawei", model: "CloudBox 300", user: "刘洋", dept: "刑事审判庭", room: "204", ip: "10.20.30.27", net_type: "专网", status: "维修中", cpu: "4 核 ARM", memory: "4096 MB", disk: "64 GB eMMC" },
        TerminalAsset { id: 8, name: "示例一体机 08", box_sn: "SN-AIO-338210", code: "ZCY-DZ-202610-008", device_type: "一体机", brand: "联想 Lenovo", model: "开天 A6000", user: "孙悦", dept: "执行局", room: "201", ip: "192.168.10.60", net_type: "内网", status: "使用中", cpu: "1 × 兆芯 KX-6640MA", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 9, name: "示例便携本 09", box_sn: "SN-THINK-77218", code: "ZCY-DZ-202610-009", device_type: "笔记本", brand: "联想 Lenovo", model: "昭阳 X5", user: "陈杰", dept: "审判管理办公室", room: "502", ip: "192.168.10.71", net_type: "内网", status: "使用中", cpu: "1 × Intel Core i7-1260P", memory: "16384 MB", disk: "1 TB NVMe" },
        TerminalAsset { id: 10, name: "示例外网查询机 10", box_sn: "SN-DELL-992104", code: "ZCY-DZ-202610-010", device_type: "台式电脑", brand: "戴尔 Dell", model: "OptiPlex 3080", user: "诉服大厅公用", dept: "立案庭（诉讼服务中心）", room: "101", ip: "203.0.113.12", net_type: "外网", status: "使用中", cpu: "1 × Intel Core i3-10105", memory: "8192 MB", disk: "256 GB SSD" },
        TerminalAsset { id: 11, name: "示例云桌面 11", box_sn: "BOX-202610-011", code: "ZCY-DZ-202610-011", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "周华", dept: "行政审判庭", room: "308", ip: "10.20.30.35", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 12, name: "示例云桌面 12", box_sn: "BOX-202610-012", code: "ZCY-DZ-202610-012", device_type: "云桌面", brand: "深信服", model: "aDesk STD-200", user: "吴芳", dept: "司法警察支队", room: "112", ip: "10.20.30.36", net_type: "专网", status: "使用中", cpu: "4 vCPU", memory: "8192 MB", disk: "128 GB SSD" },
        TerminalAsset { id: 13, name: "示例彩色打印机 13", box_sn: "SN-LENOVO-8812", code: "ZCY-DZ-202610-013", device_type: "打印机", brand: "联想 Lenovo", model: "LJ2205", user: "集中印制室", dept: "综合办公室", room: "103", ip: "192.168.10.88", net_type: "内网", status: "使用中", cpu: "内置控制器", memory: "512 MB", disk: "无" },
        TerminalAsset { id: 14, name: "示例报废台式机 14", box_sn: "SN-DELL-332190", code: "ZCY-DZ-202610-014", device_type: "台式电脑", brand: "联想 Lenovo", model: "启天 M4350", user: "已清退", dept: "设备库房", room: "地下室", ip: "192.168.10.99", net_type: "内网", status: "已注销", cpu: "1 × Intel Core i3-3220", memory: "4096 MB", disk: "500 GB HDD" },
    ]
}
