//! 探针工程：零依赖，用于实测 IDEA 社区版的 Rust 语义能力

/// 探针结构体
pub struct ProbeConfig {
    pub name: String,
    pub retries: u32,
}

/// 探针函数：被 probe_helper 调用
pub fn probe_helper(cfg: &ProbeConfig) -> String {
    format!("{}:{}", cfg.name, cfg.retries)
}

/// 探针入口
pub fn main_probe() -> u32 {
    let cfg = ProbeConfig { name: "x".to_string(), retries: 3 };
    probe_helper(&cfg).len() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn probe_works() {
        assert_eq!(main_probe(), 4);
    }
}
