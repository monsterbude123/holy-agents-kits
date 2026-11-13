# skills运行时
> 目的是为了不污染项目或者全局的环境变量，方便只在agents工作的时候skills的工作环境；

- skills需要一下环境变量配置的时候，留一个.env.example在skills目录做示范；
- skills运行时新增 `.agents/.env` 的优先级的概念,解析脚步去读取对应的配置；