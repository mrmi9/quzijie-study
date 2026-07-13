// 此文件由 npm run build:data 从 content/cpp-questions.json 生成，请勿直接编辑。
module.exports = [
  {
    "id": "cpp001",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "下列哪个是合法的 C/C++ 标识符？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "2value"
      },
      {
        "id": "B",
        "label": "B",
        "text": "user-name"
      },
      {
        "id": "C",
        "label": "C",
        "text": "total_count"
      },
      {
        "id": "D",
        "label": "D",
        "text": "class"
      }
    ],
    "correctOptionIds": [
      "C"
    ],
    "explanation": "标识符不能以数字开头，不能包含连字符，也不能使用关键字；total_count 符合规则。",
    "difficulty": 1,
    "tags": [
      "标识符",
      "关键字"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp002",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "按照 C/C++ 标准，sizeof(char) 的结果是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "1"
      },
      {
        "id": "B",
        "label": "B",
        "text": "2"
      },
      {
        "id": "C",
        "label": "C",
        "text": "4"
      },
      {
        "id": "D",
        "label": "D",
        "text": "由编译器决定，可能为 0"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "标准规定 sizeof(char)、sizeof(signed char) 和 sizeof(unsigned char) 都为 1 个字节。",
    "difficulty": 1,
    "tags": [
      "sizeof",
      "基本类型"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp003",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "表达式 7 / 2 的两个操作数都是 int，结果是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "3"
      },
      {
        "id": "B",
        "label": "B",
        "text": "3.5"
      },
      {
        "id": "C",
        "label": "C",
        "text": "4"
      },
      {
        "id": "D",
        "label": "D",
        "text": "编译错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "两个整数相除执行整数除法，小数部分向零截断，因此结果为 3。",
    "difficulty": 1,
    "tags": [
      "整数除法",
      "表达式"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp004",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "表达式 2 + 3 * 4 的值是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "14"
      },
      {
        "id": "B",
        "label": "B",
        "text": "20"
      },
      {
        "id": "C",
        "label": "C",
        "text": "24"
      },
      {
        "id": "D",
        "label": "D",
        "text": "9"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "乘法优先级高于加法，先计算 3 * 4，再加 2，结果为 14。",
    "difficulty": 1,
    "tags": [
      "运算符",
      "优先级"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp005",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "multiple",
    "stem": "下列哪些写法表示整数常量？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "10"
      },
      {
        "id": "B",
        "label": "B",
        "text": "012"
      },
      {
        "id": "C",
        "label": "C",
        "text": "0x10"
      },
      {
        "id": "D",
        "label": "D",
        "text": "3.14"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "10 是十进制整数，012 是八进制整数，0x10 是十六进制整数；3.14 是浮点常量。",
    "difficulty": 1,
    "tags": [
      "整数常量",
      "进制"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp006",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "judge",
    "stem": "C 和 C++ 的标识符都区分大小写，因此 value 与 Value 是两个不同的名称。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "两种语言的标识符都区分大小写，大小写不同会被视为不同标识符。",
    "difficulty": 1,
    "tags": [
      "标识符",
      "大小写"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp007",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "表达式 5 % 2 的值是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "0"
      },
      {
        "id": "B",
        "label": "B",
        "text": "1"
      },
      {
        "id": "C",
        "label": "C",
        "text": "2"
      },
      {
        "id": "D",
        "label": "D",
        "text": "2.5"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "% 计算整数除法的余数，5 除以 2 的余数为 1。",
    "difficulty": 1,
    "tags": [
      "取模",
      "运算符"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp008",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "在源代码中，'A' 与 \"A\" 的主要区别是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "'A' 是字符常量，\"A\" 是包含终止符的字符串字面量"
      },
      {
        "id": "B",
        "label": "B",
        "text": "两者完全相同"
      },
      {
        "id": "C",
        "label": "C",
        "text": "'A' 是字符串，\"A\" 是字符"
      },
      {
        "id": "D",
        "label": "D",
        "text": "两者都会被当作整数数组"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "单引号表示字符常量；双引号表示字符串字面量，内容还包含结尾的空字符。",
    "difficulty": 1,
    "tags": [
      "字符",
      "字符串"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp009",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "使用 scanf 读取一个 double 变量时应使用哪个格式说明符？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "%d"
      },
      {
        "id": "B",
        "label": "B",
        "text": "%f"
      },
      {
        "id": "C",
        "label": "C",
        "text": "%lf"
      },
      {
        "id": "D",
        "label": "D",
        "text": "%c"
      }
    ],
    "correctOptionIds": [
      "C"
    ],
    "explanation": "scanf 中 %f 对应 float*，%lf 对应 double*，因此读取 double 应使用 %lf。",
    "difficulty": 2,
    "tags": [
      "输入输出",
      "double"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp010",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "single",
    "stem": "执行 int x = (1, 2, 3); 后，x 的值是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "1"
      },
      {
        "id": "B",
        "label": "B",
        "text": "2"
      },
      {
        "id": "C",
        "label": "C",
        "text": "3"
      },
      {
        "id": "D",
        "label": "D",
        "text": "6"
      }
    ],
    "correctOptionIds": [
      "C"
    ],
    "explanation": "逗号运算符从左到右计算各表达式，并以最后一个表达式的值作为整体结果。",
    "difficulty": 2,
    "tags": [
      "逗号运算符",
      "表达式"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp011",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "multiple",
    "stem": "下列哪些属于逻辑运算符？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "&&"
      },
      {
        "id": "B",
        "label": "B",
        "text": "||"
      },
      {
        "id": "C",
        "label": "C",
        "text": "!"
      },
      {
        "id": "D",
        "label": "D",
        "text": "&"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "&&、||、! 分别是逻辑与、逻辑或、逻辑非；单个 & 是按位与，也可用于取地址。",
    "difficulty": 1,
    "tags": [
      "逻辑运算符",
      "按位运算"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp012",
    "chapterId": "c-basics",
    "chapterName": "C 基础与运算",
    "chapterOrder": 1,
    "type": "judge",
    "stem": "在 C/C++ 中，赋值表达式本身具有值，其值是赋值完成后左操作数的值。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "赋值不仅产生副作用，也会得到一个值，因此可以进行链式赋值等操作。",
    "difficulty": 2,
    "tags": [
      "赋值",
      "表达式"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp013",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "没有花括号消除歧义时，else 会与哪个 if 匹配？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "同一语句中最近且尚未匹配的 if"
      },
      {
        "id": "B",
        "label": "B",
        "text": "最外层 if"
      },
      {
        "id": "C",
        "label": "C",
        "text": "第一个 if"
      },
      {
        "id": "D",
        "label": "D",
        "text": "由运行时决定"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "语法规则规定 else 与最近的、尚未配对的 if 匹配；实际编程应使用花括号提升可读性。",
    "difficulty": 1,
    "tags": [
      "if",
      "else"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp014",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "下列循环体会执行多少次？",
    "code": "for (int i = 0; i < 5; ++i) {\n    /* 循环体 */\n}",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "4 次"
      },
      {
        "id": "B",
        "label": "B",
        "text": "5 次"
      },
      {
        "id": "C",
        "label": "C",
        "text": "6 次"
      },
      {
        "id": "D",
        "label": "D",
        "text": "无限次"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "i 依次取 0、1、2、3、4，共执行 5 次；当 i 变为 5 时条件为假。",
    "difficulty": 1,
    "tags": [
      "for",
      "循环"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp015",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "multiple",
    "stem": "关于 while 与 do-while，下列说法哪些正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "while 循环体可能一次也不执行"
      },
      {
        "id": "B",
        "label": "B",
        "text": "do-while 循环体至少执行一次"
      },
      {
        "id": "C",
        "label": "C",
        "text": "do-while 先判断条件再执行循环体"
      },
      {
        "id": "D",
        "label": "D",
        "text": "两者都可以使用 break 退出"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "D"
    ],
    "explanation": "while 先判断；do-while 先执行后判断，所以至少执行一次；两种循环都可以用 break 退出。",
    "difficulty": 1,
    "tags": [
      "while",
      "do-while"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp016",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "下列哪种值不能直接作为标准 C/C++ switch 语句的控制表达式？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "int"
      },
      {
        "id": "B",
        "label": "B",
        "text": "char"
      },
      {
        "id": "C",
        "label": "C",
        "text": "枚举值"
      },
      {
        "id": "D",
        "label": "D",
        "text": "double"
      }
    ],
    "correctOptionIds": [
      "D"
    ],
    "explanation": "switch 控制表达式要求整数类型或枚举类型，浮点类型 double 不能直接使用。",
    "difficulty": 2,
    "tags": [
      "switch",
      "类型"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp017",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "judge",
    "stem": "break 只会退出它所在的最内层循环或 switch，不会自动退出所有外层循环。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "普通 break 的作用范围是最内层循环或 switch；退出多层结构需要额外控制逻辑。",
    "difficulty": 1,
    "tags": [
      "break",
      "循环"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp018",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "循环中的 continue 语句通常表示什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "结束整个程序"
      },
      {
        "id": "B",
        "label": "B",
        "text": "跳过本次循环剩余语句，进入下一次迭代"
      },
      {
        "id": "C",
        "label": "C",
        "text": "永久停止循环"
      },
      {
        "id": "D",
        "label": "D",
        "text": "返回调用函数"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "continue 不结束循环，而是跳过本次迭代中其后的语句，并进入下一次迭代判断。",
    "difficulty": 1,
    "tags": [
      "continue",
      "循环"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp019",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "设计递归函数时，防止无限递归最关键的部分是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "使用全局变量"
      },
      {
        "id": "B",
        "label": "B",
        "text": "设置能够到达的终止条件"
      },
      {
        "id": "C",
        "label": "C",
        "text": "把返回类型改为 void"
      },
      {
        "id": "D",
        "label": "D",
        "text": "每次递归都输出日志"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "递归必须有明确且可达的终止条件，并让问题规模逐步趋近该条件。",
    "difficulty": 1,
    "tags": [
      "递归",
      "终止条件"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp020",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "judge",
    "stem": "函数内的 static 局部变量只初始化一次，其生命周期持续到程序结束。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "static 局部变量具有静态存储期，但作用域仍局限于声明它的代码块。",
    "difficulty": 2,
    "tags": [
      "static",
      "生命周期"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp021",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "在 C 语言中，普通形参采用值传递意味着什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "函数直接操作实参对象本身"
      },
      {
        "id": "B",
        "label": "B",
        "text": "函数得到实参值的副本"
      },
      {
        "id": "C",
        "label": "C",
        "text": "形参始终是引用"
      },
      {
        "id": "D",
        "label": "D",
        "text": "实参会在调用后被销毁"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "值传递把实参的值复制给形参，修改普通形参不会直接改变调用者中的实参对象。",
    "difficulty": 1,
    "tags": [
      "函数",
      "值传递"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp022",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "下列哪个是接收两个 int 并返回 int 的函数声明？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "int add(int, int);"
      },
      {
        "id": "B",
        "label": "B",
        "text": "add(int, int);"
      },
      {
        "id": "C",
        "label": "C",
        "text": "int add;"
      },
      {
        "id": "D",
        "label": "D",
        "text": "int(int, int) add[];"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "函数声明需要给出返回类型、函数名和参数类型列表；形参名称在声明中可以省略。",
    "difficulty": 1,
    "tags": [
      "函数声明",
      "原型"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp023",
    "chapterId": "control-functions",
    "chapterName": "流程控制与函数",
    "chapterOrder": 2,
    "type": "single",
    "stem": "下列代码最终输出什么？",
    "code": "int sum = 0;\nfor (int i = 1; i <= 3; ++i) {\n    sum += i;\n}\nprintf(\"%d\", sum);",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "3"
      },
      {
        "id": "B",
        "label": "B",
        "text": "5"
      },
      {
        "id": "C",
        "label": "C",
        "text": "6"
      },
      {
        "id": "D",
        "label": "D",
        "text": "7"
      }
    ],
    "correctOptionIds": [
      "C"
    ],
    "explanation": "循环依次把 1、2、3 加入 sum，最终 sum 等于 6。",
    "difficulty": 1,
    "tags": [
      "for",
      "代码阅读"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp024",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "长度为 10 的数组，其最后一个合法下标是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "8"
      },
      {
        "id": "B",
        "label": "B",
        "text": "9"
      },
      {
        "id": "C",
        "label": "C",
        "text": "10"
      },
      {
        "id": "D",
        "label": "D",
        "text": "11"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "数组下标从 0 开始，因此长度为 10 的数组合法下标范围是 0 到 9。",
    "difficulty": 1,
    "tags": [
      "数组",
      "下标"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp025",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "在数组声明所在作用域内，计算 int a[8] 元素个数的常见表达式是哪个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "sizeof(a) / sizeof(a[0])"
      },
      {
        "id": "B",
        "label": "B",
        "text": "sizeof(a[0]) / sizeof(a)"
      },
      {
        "id": "C",
        "label": "C",
        "text": "sizeof(a)"
      },
      {
        "id": "D",
        "label": "D",
        "text": "strlen(a)"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "完整数组总字节数除以单个元素字节数即可得到元素个数；数组传入函数后通常已退化为指针，不能这样计算。",
    "difficulty": 2,
    "tags": [
      "数组",
      "sizeof"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp026",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "C 风格字符串以哪个字符作为结束标志？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "'\\n'"
      },
      {
        "id": "B",
        "label": "B",
        "text": "'\\0'"
      },
      {
        "id": "C",
        "label": "C",
        "text": "' '"
      },
      {
        "id": "D",
        "label": "D",
        "text": "EOF"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "C 风格字符串是以空字符 '\\0' 结尾的字符序列，字符串函数依赖该结束标志。",
    "difficulty": 1,
    "tags": [
      "字符串",
      "终止符"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp027",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "strlen(\"hello\") 的结果是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "4"
      },
      {
        "id": "B",
        "label": "B",
        "text": "5"
      },
      {
        "id": "C",
        "label": "C",
        "text": "6"
      },
      {
        "id": "D",
        "label": "D",
        "text": "取决于 char 大小"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "strlen 返回终止空字符之前的字符数，不把结尾的 '\\0' 计入长度，因此结果为 5。",
    "difficulty": 1,
    "tags": [
      "strlen",
      "字符串"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp028",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "执行 char text[] = \"abc\"; 后，数组 text 的元素个数是多少？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "3"
      },
      {
        "id": "B",
        "label": "B",
        "text": "4"
      },
      {
        "id": "C",
        "label": "C",
        "text": "5"
      },
      {
        "id": "D",
        "label": "D",
        "text": "无法确定"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "数组包含 a、b、c 和编译器自动添加的字符串终止符 '\\0'，共 4 个元素。",
    "difficulty": 1,
    "tags": [
      "字符数组",
      "字符串"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp029",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "judge",
    "stem": "标准 C/C++ 的内置二维数组按行连续存储，即先存完一行再存下一行。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "多维内置数组采用行主序连续布局，最右侧下标对应的维度变化最快。",
    "difficulty": 2,
    "tags": [
      "二维数组",
      "内存布局"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp030",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "judge",
    "stem": "数组作为普通函数参数传递时，形参声明中的数组类型会调整为指向元素的指针类型。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "例如参数 int a[] 会调整为 int*；因此函数内仅凭该形参无法用 sizeof 得到原数组总大小。",
    "difficulty": 2,
    "tags": [
      "数组参数",
      "指针"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp031",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "judge",
    "stem": "两个同类型内置数组可以直接使用赋值运算符进行整体赋值。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "内置数组不支持整体赋值，通常需要逐元素复制或使用适合的复制函数。",
    "difficulty": 1,
    "tags": [
      "数组",
      "赋值"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp032",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "multiple",
    "stem": "使用 strcpy(dest, src) 前，调用者需要保证哪些条件？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "src 是以 '\\0' 结尾的有效字符串"
      },
      {
        "id": "B",
        "label": "B",
        "text": "dest 有足够空间容纳内容和终止符"
      },
      {
        "id": "C",
        "label": "C",
        "text": "源和目标内存不能以未定义方式重叠"
      },
      {
        "id": "D",
        "label": "D",
        "text": "dest 必须位于只读存储区"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "strcpy 依赖源字符串终止符，目标空间必须充足，源和目标不应重叠；目标当然必须可写。",
    "difficulty": 2,
    "tags": [
      "strcpy",
      "缓冲区"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp033",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "single",
    "stem": "下列代码中 strlen(s) 的结果是多少？",
    "code": "char s[5] = {'a', 'b'};\nsize_t n = strlen(s);",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "2"
      },
      {
        "id": "B",
        "label": "B",
        "text": "3"
      },
      {
        "id": "C",
        "label": "C",
        "text": "5"
      },
      {
        "id": "D",
        "label": "D",
        "text": "行为未定义"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "部分初始化数组时，剩余元素会被零初始化，因此 s 的第三个元素是 '\\0'，字符串长度为 2。",
    "difficulty": 2,
    "tags": [
      "数组初始化",
      "strlen"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp034",
    "chapterId": "arrays-strings",
    "chapterName": "数组与字符串",
    "chapterOrder": 3,
    "type": "multiple",
    "stem": "下列哪些函数用于处理 C 风格字符串？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "strlen"
      },
      {
        "id": "B",
        "label": "B",
        "text": "strcmp"
      },
      {
        "id": "C",
        "label": "C",
        "text": "strcpy"
      },
      {
        "id": "D",
        "label": "D",
        "text": "malloc"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "strlen、strcmp、strcpy 都是字符串处理函数；malloc 负责动态内存分配。",
    "difficulty": 1,
    "tags": [
      "字符串函数",
      "标准库"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp035",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "若 int value = 10;，哪个表达式能够得到 value 的地址？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "*value"
      },
      {
        "id": "B",
        "label": "B",
        "text": "&value"
      },
      {
        "id": "C",
        "label": "C",
        "text": "value*"
      },
      {
        "id": "D",
        "label": "D",
        "text": "value&"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "一元取地址运算符 & 返回对象的地址，结果可赋给兼容类型的指针。",
    "difficulty": 1,
    "tags": [
      "指针",
      "取地址"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp036",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "judge",
    "stem": "解引用空指针会产生未定义行为，程序不能依赖某一种固定结果。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "空指针不指向有效对象，对其解引用属于未定义行为，可能崩溃也可能出现其他异常。",
    "difficulty": 1,
    "tags": [
      "空指针",
      "未定义行为"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp037",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "int* p 指向数组元素时，p + 1 通常指向哪里？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "向后移动 1 个字节"
      },
      {
        "id": "B",
        "label": "B",
        "text": "下一个 int 元素"
      },
      {
        "id": "C",
        "label": "C",
        "text": "数组首元素"
      },
      {
        "id": "D",
        "label": "D",
        "text": "空指针"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "指针算术以所指类型的大小为单位，p + 1 指向下一个 int 元素，而不是简单增加一个字节。",
    "difficulty": 1,
    "tags": [
      "指针算术",
      "数组"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp038",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "C 语言中 malloc 的声明位于哪个标准头文件？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "<stdio.h>"
      },
      {
        "id": "B",
        "label": "B",
        "text": "<stdlib.h>"
      },
      {
        "id": "C",
        "label": "C",
        "text": "<string.h>"
      },
      {
        "id": "D",
        "label": "D",
        "text": "<math.h>"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "malloc、calloc、realloc 和 free 的声明位于 C 标准头文件 <stdlib.h>。",
    "difficulty": 1,
    "tags": [
      "malloc",
      "头文件"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp039",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "multiple",
    "stem": "关于 free(ptr)，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "ptr 应为空指针或来自兼容分配函数的有效地址"
      },
      {
        "id": "B",
        "label": "B",
        "text": "同一分配块不能重复释放"
      },
      {
        "id": "C",
        "label": "C",
        "text": "释放后原指针值会自动变成 NULL"
      },
      {
        "id": "D",
        "label": "D",
        "text": "free(NULL) 是安全的空操作"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "D"
    ],
    "explanation": "free 可接收 NULL；有效分配块只能释放一次。free 不会自动把调用者的指针变量改为 NULL。",
    "difficulty": 2,
    "tags": [
      "free",
      "动态内存"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp040",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "C++ 中使用 new int 创建的单个对象应如何释放？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "free(ptr)"
      },
      {
        "id": "B",
        "label": "B",
        "text": "delete ptr"
      },
      {
        "id": "C",
        "label": "C",
        "text": "delete[] ptr"
      },
      {
        "id": "D",
        "label": "D",
        "text": "无需释放"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "单对象 new 必须与 delete 配对；不能与 free 或 delete[] 混用。",
    "difficulty": 1,
    "tags": [
      "new",
      "delete"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp041",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "C++ 中使用 new int[10] 分配的数组应如何释放？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "delete ptr"
      },
      {
        "id": "B",
        "label": "B",
        "text": "delete[] ptr"
      },
      {
        "id": "C",
        "label": "C",
        "text": "free(ptr)"
      },
      {
        "id": "D",
        "label": "D",
        "text": "clear(ptr)"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "数组形式 new[] 必须与数组形式 delete[] 配对，否则行为未定义。",
    "difficulty": 1,
    "tags": [
      "new[]",
      "delete[]"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp042",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "“悬空指针”通常指什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "值为零的指针"
      },
      {
        "id": "B",
        "label": "B",
        "text": "指向已结束生命周期对象或已释放内存的指针"
      },
      {
        "id": "C",
        "label": "C",
        "text": "指向常量的指针"
      },
      {
        "id": "D",
        "label": "D",
        "text": "未参与运算的指针"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "对象生命周期结束或内存释放后，仍保存原地址的指针不再指向有效对象，成为悬空指针。",
    "difficulty": 1,
    "tags": [
      "悬空指针",
      "生命周期"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp043",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "multiple",
    "stem": "关于 const int* p 与 int* const p，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "const int* p 不能通过 p 修改所指 int"
      },
      {
        "id": "B",
        "label": "B",
        "text": "const int* p 本身可以改指向"
      },
      {
        "id": "C",
        "label": "C",
        "text": "int* const p 本身不能改指向"
      },
      {
        "id": "D",
        "label": "D",
        "text": "int* const p 永远不能修改所指 int"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "const 靠近 int 时限制所指对象的修改；const 修饰指针本身时限制指针改指向，但不阻止通过它修改非 const 对象。",
    "difficulty": 2,
    "tags": [
      "const",
      "指针"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp044",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "judge",
    "stem": "在 C++ 中，void* 不能像 C 那样无需显式转换就赋给任意对象指针类型。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "C++ 不允许从 void* 到具体对象指针的隐式转换，通常需要显式转换；反方向转换为 void* 可以隐式进行。",
    "difficulty": 2,
    "tags": [
      "void指针",
      "类型转换"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp045",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "调用 swap_value(&a, &b) 后，a 与 b 的值会怎样？",
    "code": "void swap_value(int* x, int* y) {\n    int temp = *x;\n    *x = *y;\n    *y = temp;\n}",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "互换"
      },
      {
        "id": "B",
        "label": "B",
        "text": "都变为 0"
      },
      {
        "id": "C",
        "label": "C",
        "text": "保持不变"
      },
      {
        "id": "D",
        "label": "D",
        "text": "一定编译失败"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "函数接收两个对象的地址，通过解引用修改对应对象，因此调用后两者的值被交换。",
    "difficulty": 2,
    "tags": [
      "指针参数",
      "代码阅读"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp046",
    "chapterId": "pointers-memory",
    "chapterName": "指针与动态内存",
    "chapterOrder": 4,
    "type": "single",
    "stem": "动态分配的内存失去所有可用于释放它的地址，但仍未释放，这种问题称为什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "缓冲区命中"
      },
      {
        "id": "B",
        "label": "B",
        "text": "内存泄漏"
      },
      {
        "id": "C",
        "label": "C",
        "text": "短路求值"
      },
      {
        "id": "D",
        "label": "D",
        "text": "名字隐藏"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "程序无法再访问和释放仍占用的动态存储块时，就发生了内存泄漏。",
    "difficulty": 1,
    "tags": [
      "内存泄漏",
      "动态内存"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp047",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "已知 struct Point { int x; int y; }; Point p;，访问成员 x 应使用哪个表达式？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "p->x"
      },
      {
        "id": "B",
        "label": "B",
        "text": "p.x"
      },
      {
        "id": "C",
        "label": "C",
        "text": "p::x"
      },
      {
        "id": "D",
        "label": "D",
        "text": "p[x]"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "对象本身使用点运算符访问成员；只有指向对象的指针通常使用箭头运算符。",
    "difficulty": 1,
    "tags": [
      "结构体",
      "成员访问"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp048",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "若 Point* ptr 指向有效的 Point 对象，访问其成员 y 应使用哪个表达式？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "ptr.y"
      },
      {
        "id": "B",
        "label": "B",
        "text": "ptr->y"
      },
      {
        "id": "C",
        "label": "C",
        "text": "ptr::y"
      },
      {
        "id": "D",
        "label": "D",
        "text": "&ptr.y"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "箭头运算符 ptr->y 等价于 (*ptr).y，用于通过对象指针访问成员。",
    "difficulty": 1,
    "tags": [
      "结构体指针",
      "箭头运算符"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp049",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "judge",
    "stem": "联合体 union 的各成员共享同一段存储空间，通常只有最近写入成员对应的值可按规则读取。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "联合体成员从同一地址开始并共享存储，写入一个成员会改变共享存储中的表示。",
    "difficulty": 2,
    "tags": [
      "union",
      "内存"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp050",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "若定义 enum Color { Red, Green, Blue }; 且未显式赋值，Green 通常对应哪个整数值？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "0"
      },
      {
        "id": "B",
        "label": "B",
        "text": "1"
      },
      {
        "id": "C",
        "label": "C",
        "text": "2"
      },
      {
        "id": "D",
        "label": "D",
        "text": "-1"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "未显式指定时，第一个枚举常量从 0 开始，后续依次加 1，因此 Green 为 1。",
    "difficulty": 1,
    "tags": [
      "enum",
      "枚举"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp051",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "fopen(\"data.txt\", \"r\") 中模式 \"r\" 表示什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "只读打开已有文本文件"
      },
      {
        "id": "B",
        "label": "B",
        "text": "追加写入"
      },
      {
        "id": "C",
        "label": "C",
        "text": "覆盖写入"
      },
      {
        "id": "D",
        "label": "D",
        "text": "创建目录"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "\"r\" 以读取方式打开已有文件；若文件不存在，打开失败并返回空指针。",
    "difficulty": 1,
    "tags": [
      "文件",
      "fopen"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp052",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "multiple",
    "stem": "成功 fopen 后，适时调用 fclose 的作用包括哪些？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "刷新尚未写出的缓冲数据"
      },
      {
        "id": "B",
        "label": "B",
        "text": "释放与流相关的资源"
      },
      {
        "id": "C",
        "label": "C",
        "text": "自动删除文件"
      },
      {
        "id": "D",
        "label": "D",
        "text": "报告关闭时可能发生的错误"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "D"
    ],
    "explanation": "fclose 会刷新输出缓冲并释放流资源，返回值还能反映关闭错误；它不会自动删除文件。",
    "difficulty": 2,
    "tags": [
      "fclose",
      "文件资源"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp053",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "用 fgetc 读取字符时，为什么通常要用 int 变量接收返回值？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "为了同时表示所有 unsigned char 值和 EOF"
      },
      {
        "id": "B",
        "label": "B",
        "text": "因为 char 不能参与比较"
      },
      {
        "id": "C",
        "label": "C",
        "text": "为了自动关闭文件"
      },
      {
        "id": "D",
        "label": "D",
        "text": "因为 fgetc 返回 double"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "fgetc 需要返回所有可能的无符号字符值，还要返回额外的 EOF 标志，因此返回类型是 int。",
    "difficulty": 2,
    "tags": [
      "fgetc",
      "EOF"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp054",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "定义平方宏时，哪个写法更能避免实参运算符优先级问题？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "#define SQUARE(x) x*x"
      },
      {
        "id": "B",
        "label": "B",
        "text": "#define SQUARE(x) ((x) * (x))"
      },
      {
        "id": "C",
        "label": "C",
        "text": "#define SQUARE x"
      },
      {
        "id": "D",
        "label": "D",
        "text": "#define SQUARE(x) x^2"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "给每次参数替换和整个结果加括号能减少优先级造成的错误，但宏仍可能重复求值实参。",
    "difficulty": 2,
    "tags": [
      "宏",
      "优先级"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp055",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "multiple",
    "stem": "传统头文件防重复包含保护通常需要哪些预处理指令？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "#ifndef"
      },
      {
        "id": "B",
        "label": "B",
        "text": "#define"
      },
      {
        "id": "C",
        "label": "C",
        "text": "#endif"
      },
      {
        "id": "D",
        "label": "D",
        "text": "#error"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "传统 include guard 使用 #ifndef 检查、#define 标记，并用 #endif 结束条件块。",
    "difficulty": 1,
    "tags": [
      "头文件",
      "include guard"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp056",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "judge",
    "stem": "#ifdef NAME 用于判断预处理宏 NAME 是否已被定义。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "#ifdef 在宏已定义时保留对应条件编译分支，与宏替换后的具体值无关。",
    "difficulty": 1,
    "tags": [
      "条件编译",
      "ifdef"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp057",
    "chapterId": "struct-file-preprocessor",
    "chapterName": "结构体、文件与预处理",
    "chapterOrder": 5,
    "type": "single",
    "stem": "哪个预定义宏通常展开为当前源文件名字符串？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "__LINE__"
      },
      {
        "id": "B",
        "label": "B",
        "text": "__FILE__"
      },
      {
        "id": "C",
        "label": "C",
        "text": "__DATE_ONLY__"
      },
      {
        "id": "D",
        "label": "D",
        "text": "__SOURCE__"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "__FILE__ 展开为当前源文件名字符串；__LINE__ 展开为当前源代码行号。",
    "difficulty": 1,
    "tags": [
      "预定义宏",
      "调试"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp058",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "judge",
    "stem": "普通 C++ 左值引用在定义时必须绑定到一个有效对象，不能先声明后再绑定。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "引用不是可重新绑定的独立对象，定义引用时必须完成初始化。",
    "difficulty": 1,
    "tags": [
      "引用",
      "初始化"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp059",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "下列哪个引用可以直接绑定到临时值 42？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "int&"
      },
      {
        "id": "B",
        "label": "B",
        "text": "const int&"
      },
      {
        "id": "C",
        "label": "C",
        "text": "volatile int&"
      },
      {
        "id": "D",
        "label": "D",
        "text": "int*&"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "const 左值引用可以绑定到临时对象，并把该临时对象的生命周期延长到引用的生命周期范围。",
    "difficulty": 2,
    "tags": [
      "const引用",
      "临时对象"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp060",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "访问命名空间 demo 中的函数 run，应使用哪个表达式？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "demo.run()"
      },
      {
        "id": "B",
        "label": "B",
        "text": "demo::run()"
      },
      {
        "id": "C",
        "label": "C",
        "text": "demo->run()"
      },
      {
        "id": "D",
        "label": "D",
        "text": "demo/run()"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "C++ 使用作用域解析运算符 :: 访问命名空间或类作用域中的名称。",
    "difficulty": 1,
    "tags": [
      "命名空间",
      "作用域"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp061",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "multiple",
    "stem": "关于 C++ bool 类型，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "字面量 true 和 false 的类型是 bool"
      },
      {
        "id": "B",
        "label": "B",
        "text": "零转换为 false"
      },
      {
        "id": "C",
        "label": "C",
        "text": "非零整数转换为 true"
      },
      {
        "id": "D",
        "label": "D",
        "text": "bool 变量只能占用 4 字节"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "true/false 是 bool 字面量，整数零转为 false，非零转为 true；bool 对象大小由实现决定，但至少能表示两个值。",
    "difficulty": 1,
    "tags": [
      "bool",
      "类型转换"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp062",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "现代 C++ 中更适合表示空指针的字面量是哪一个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "0.0"
      },
      {
        "id": "B",
        "label": "B",
        "text": "nullptr"
      },
      {
        "id": "C",
        "label": "C",
        "text": "'0'"
      },
      {
        "id": "D",
        "label": "D",
        "text": "void"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "nullptr 具有专门的 std::nullptr_t 类型，能避免整数 0 或 NULL 在重载解析中的歧义。",
    "difficulty": 1,
    "tags": [
      "nullptr",
      "现代C++"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp063",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "默认情况下，C++ 的 new 表达式分配失败时通常会怎样？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "返回整数 -1"
      },
      {
        "id": "B",
        "label": "B",
        "text": "抛出 std::bad_alloc"
      },
      {
        "id": "C",
        "label": "C",
        "text": "静默返回任意地址"
      },
      {
        "id": "D",
        "label": "D",
        "text": "自动调用 free"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "普通 new 分配失败时抛出 std::bad_alloc；使用 nothrow 形式时才会以空指针表示失败。",
    "difficulty": 2,
    "tags": [
      "new",
      "异常"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp064",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "judge",
    "stem": "给函数加上 inline 说明符并不能强制编译器一定进行内联展开。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "是否实际内联是编译器优化决定；inline 更重要的语言层作用涉及多翻译单元定义规则。",
    "difficulty": 2,
    "tags": [
      "inline",
      "编译器"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp065",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "同一参数列表中已有默认实参后，后续参数通常应满足什么要求？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "后续参数也应有默认实参"
      },
      {
        "id": "B",
        "label": "B",
        "text": "后续参数必须是指针"
      },
      {
        "id": "C",
        "label": "C",
        "text": "后续参数必须按引用传递"
      },
      {
        "id": "D",
        "label": "D",
        "text": "没有任何限制"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "调用时实参按尾部省略，因此从某个参数开始提供默认实参后，其右侧参数也需要有可用默认值。",
    "difficulty": 2,
    "tags": [
      "默认参数",
      "函数"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp066",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "judge",
    "stem": "C++ 函数不能仅靠返回类型不同构成有效重载。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "函数调用的重载解析主要依据函数名和参数列表；返回类型不参与仅靠调用表达式完成的重载区分。",
    "difficulty": 1,
    "tags": [
      "函数重载",
      "返回类型"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp067",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "single",
    "stem": "执行下列代码后，value 的值是多少？",
    "code": "void add_one(int& x) {\n    ++x;\n}\nint value = 5;\nadd_one(value);",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "4"
      },
      {
        "id": "B",
        "label": "B",
        "text": "5"
      },
      {
        "id": "C",
        "label": "C",
        "text": "6"
      },
      {
        "id": "D",
        "label": "D",
        "text": "未定义"
      }
    ],
    "correctOptionIds": [
      "C"
    ],
    "explanation": "形参 x 是 value 的引用，++x 直接修改 value，因此调用后值为 6。",
    "difficulty": 1,
    "tags": [
      "引用参数",
      "代码阅读"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp068",
    "chapterId": "cpp-basics-references",
    "chapterName": "C++ 基础与引用",
    "chapterOrder": 6,
    "type": "multiple",
    "stem": "对于 const int* p，下列哪些操作在类型规则上允许？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "让 p 改为指向另一个 int 对象"
      },
      {
        "id": "B",
        "label": "B",
        "text": "读取 *p 的值"
      },
      {
        "id": "C",
        "label": "C",
        "text": "通过 *p 给所指对象赋新值"
      },
      {
        "id": "D",
        "label": "D",
        "text": "把 p 设为 nullptr"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "D"
    ],
    "explanation": "这是指向 const int 的非 const 指针：可以改变指针自身并读取对象，但不能通过该指针修改所指对象。",
    "difficulty": 2,
    "tags": [
      "const",
      "指针"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp069",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "multiple",
    "stem": "关于 C++ 构造函数，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "名称与类名相同"
      },
      {
        "id": "B",
        "label": "B",
        "text": "没有返回类型"
      },
      {
        "id": "C",
        "label": "C",
        "text": "可以重载"
      },
      {
        "id": "D",
        "label": "D",
        "text": "只能由程序员显式调用"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "构造函数与类同名、没有返回类型且可以重载；创建对象时通常由语言机制自动调用。",
    "difficulty": 1,
    "tags": [
      "构造函数",
      "类"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp070",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "类 Widget 的析构函数名称应写成什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "delete Widget()"
      },
      {
        "id": "B",
        "label": "B",
        "text": "~Widget()"
      },
      {
        "id": "C",
        "label": "C",
        "text": "Widget~()"
      },
      {
        "id": "D",
        "label": "D",
        "text": "destroy Widget()"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "析构函数名称由波浪号加类名组成，没有返回类型，也不能带普通形参。",
    "difficulty": 1,
    "tags": [
      "析构函数",
      "类"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp071",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "multiple",
    "stem": "关于 class 与 struct 的默认访问权限，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "class 成员默认 private"
      },
      {
        "id": "B",
        "label": "B",
        "text": "struct 成员默认 public"
      },
      {
        "id": "C",
        "label": "C",
        "text": "class 成员默认 public"
      },
      {
        "id": "D",
        "label": "D",
        "text": "两者都不能包含成员函数"
      }
    ],
    "correctOptionIds": [
      "A",
      "B"
    ],
    "explanation": "C++ 中 class 与 struct 的核心能力相近，主要默认差异之一是成员和继承的访问权限。",
    "difficulty": 1,
    "tags": [
      "class",
      "访问控制"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp072",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "非静态成员函数中的 this 通常指向什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "当前调用该成员函数的对象"
      },
      {
        "id": "B",
        "label": "B",
        "text": "所属命名空间"
      },
      {
        "id": "C",
        "label": "C",
        "text": "任意全局对象"
      },
      {
        "id": "D",
        "label": "D",
        "text": "类的静态数据区"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "this 是指向当前对象的隐式指针，静态成员函数没有与某个对象关联的 this 指针。",
    "difficulty": 1,
    "tags": [
      "this",
      "成员函数"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp073",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "类 Widget 的典型拷贝构造函数声明是哪一个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "Widget(const Widget& other);"
      },
      {
        "id": "B",
        "label": "B",
        "text": "void Widget(Widget other);"
      },
      {
        "id": "C",
        "label": "C",
        "text": "Widget& copy();"
      },
      {
        "id": "D",
        "label": "D",
        "text": "Widget(const int& other);"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "拷贝构造函数通常接收同类型对象的 const 左值引用，避免按值传参导致递归拷贝。",
    "difficulty": 2,
    "tags": [
      "拷贝构造",
      "引用"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp074",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "multiple",
    "stem": "哪些成员必须通过构造函数初始化列表完成初始化，而不能先默认构造后在函数体内赋值？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "const 数据成员"
      },
      {
        "id": "B",
        "label": "B",
        "text": "引用数据成员"
      },
      {
        "id": "C",
        "label": "C",
        "text": "普通可默认构造的 int 成员"
      },
      {
        "id": "D",
        "label": "D",
        "text": "没有默认构造函数的类类型成员"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "D"
    ],
    "explanation": "const 和引用成员必须在初始化阶段建立值或绑定；没有默认构造函数的成员也必须在初始化列表中选择可用构造函数。",
    "difficulty": 2,
    "tags": [
      "初始化列表",
      "成员"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp075",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "judge",
    "stem": "类的 static 数据成员由该类的所有对象共享，不会在每个对象中各存一份。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "静态数据成员属于类级别实体，所有对象访问的是同一个成员。",
    "difficulty": 1,
    "tags": [
      "static成员",
      "对象"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp076",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "judge",
    "stem": "友元函数虽然可以访问类的非公有成员，但它并不是该类的成员函数。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "friend 声明授予访问权限，不会把普通函数变成成员函数，因此它没有该类成员函数的 this 指针。",
    "difficulty": 2,
    "tags": [
      "friend",
      "访问控制"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp077",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "成员函数末尾的 const 限定主要表示什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "该函数不能修改对象的非 mutable 非静态数据成员"
      },
      {
        "id": "B",
        "label": "B",
        "text": "该函数只能返回 const 值"
      },
      {
        "id": "C",
        "label": "C",
        "text": "该函数只能调用一次"
      },
      {
        "id": "D",
        "label": "D",
        "text": "该函数变为静态函数"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "const 成员函数把 this 视为指向 const 对象的指针，不能修改普通数据成员，并可被 const 对象调用。",
    "difficulty": 2,
    "tags": [
      "const成员函数",
      "this"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp078",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "下列代码离开花括号作用域时会发生什么？",
    "code": "{\n    Widget object;\n    // 使用 object\n}",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "自动调用 object 的析构函数"
      },
      {
        "id": "B",
        "label": "B",
        "text": "必须手动 delete &object"
      },
      {
        "id": "C",
        "label": "C",
        "text": "对象永久存在"
      },
      {
        "id": "D",
        "label": "D",
        "text": "只调用构造函数"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "具有自动存储期的局部对象在离开作用域时自动析构，不应对它使用 delete。",
    "difficulty": 1,
    "tags": [
      "析构",
      "作用域"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp079",
    "chapterId": "classes-objects",
    "chapterName": "类与对象",
    "chapterOrder": 7,
    "type": "single",
    "stem": "对象包含其他类类型成员时，构造顺序通常是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "先构造成员对象，再执行外层构造函数体"
      },
      {
        "id": "B",
        "label": "B",
        "text": "先执行外层构造函数体，再构造成员"
      },
      {
        "id": "C",
        "label": "C",
        "text": "顺序完全随机"
      },
      {
        "id": "D",
        "label": "D",
        "text": "成员对象无需构造"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "进入外层构造函数体之前，基类和成员对象已经完成初始化；成员按类中声明顺序初始化。",
    "difficulty": 2,
    "tags": [
      "构造顺序",
      "成员对象"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp080",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "public 继承最常表达哪种设计关系？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "派生类是一种基类（is-a）"
      },
      {
        "id": "B",
        "label": "B",
        "text": "派生类拥有一个无关全局变量"
      },
      {
        "id": "C",
        "label": "C",
        "text": "两个类完全无关"
      },
      {
        "id": "D",
        "label": "D",
        "text": "基类只能有静态成员"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "公有继承保持基类公共接口，常用于表达可替换的 is-a 关系。",
    "difficulty": 1,
    "tags": [
      "public继承",
      "is-a"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp081",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "multiple",
    "stem": "要通过基类指针调用派生类覆盖函数实现运行时多态，通常需要哪些条件？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "基类对应函数声明为 virtual"
      },
      {
        "id": "B",
        "label": "B",
        "text": "派生类提供匹配的覆盖实现"
      },
      {
        "id": "C",
        "label": "C",
        "text": "通过基类指针或引用调用"
      },
      {
        "id": "D",
        "label": "D",
        "text": "必须把所有成员都声明为 static"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "虚函数、有效覆盖以及通过基类引用或指针进行调用共同形成典型的动态分派场景。",
    "difficulty": 2,
    "tags": [
      "virtual",
      "运行时多态"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp082",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "judge",
    "stem": "如果类会被当作多态基类使用并可能通过基类指针删除派生对象，基类析构函数应为 virtual。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "虚析构确保 delete 基类指针时从实际派生类型开始完整析构；否则删除行为可能未定义。",
    "difficulty": 2,
    "tags": [
      "虚析构",
      "多态"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp083",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "纯虚函数的常见声明形式是哪一个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "virtual void draw() = 0;"
      },
      {
        "id": "B",
        "label": "B",
        "text": "pure void draw();"
      },
      {
        "id": "C",
        "label": "C",
        "text": "virtual void draw() == 0;"
      },
      {
        "id": "D",
        "label": "D",
        "text": "abstract draw();"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "在虚函数声明后使用 = 0 将其声明为纯虚函数，并使所属类成为抽象类。",
    "difficulty": 1,
    "tags": [
      "纯虚函数",
      "抽象类"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp084",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "judge",
    "stem": "含有未实现纯虚函数的抽象类不能直接创建对象，但可以声明指向它的指针或引用。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "抽象类不能被实例化，却可以作为接口类型，通过指针或引用指向具体派生对象。",
    "difficulty": 1,
    "tags": [
      "抽象类",
      "实例化"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp085",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "C++ 中在派生类函数后写 override 的主要作用是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "让编译器检查它确实覆盖了基类虚函数"
      },
      {
        "id": "B",
        "label": "B",
        "text": "把函数变成静态函数"
      },
      {
        "id": "C",
        "label": "C",
        "text": "禁止函数被调用"
      },
      {
        "id": "D",
        "label": "D",
        "text": "自动生成函数体"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "override 明确表达覆盖意图；若签名不匹配任何基类虚函数，编译器会报错。",
    "difficulty": 1,
    "tags": [
      "override",
      "虚函数"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp086",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "把派生类对象按值赋给基类对象，派生类特有部分被丢失的现象叫什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "对象切片"
      },
      {
        "id": "B",
        "label": "B",
        "text": "名称修饰"
      },
      {
        "id": "C",
        "label": "C",
        "text": "短路求值"
      },
      {
        "id": "D",
        "label": "D",
        "text": "模板实例化"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "按值转换或复制到基类对象只保留基类子对象，派生类扩展部分被切掉，称为对象切片。",
    "difficulty": 2,
    "tags": [
      "对象切片",
      "继承"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp087",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "构造一个派生类对象时，基类与派生类构造函数的执行顺序通常是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "先基类，后派生类"
      },
      {
        "id": "B",
        "label": "B",
        "text": "先派生类，后基类"
      },
      {
        "id": "C",
        "label": "C",
        "text": "只执行派生类"
      },
      {
        "id": "D",
        "label": "D",
        "text": "顺序随机"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "派生对象依赖其基类子对象，因而先构造基类部分，再执行派生类构造。",
    "difficulty": 1,
    "tags": [
      "构造顺序",
      "继承"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp088",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "正常析构一个派生类对象时，派生类与基类析构函数的执行顺序通常是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "先派生类，后基类"
      },
      {
        "id": "B",
        "label": "B",
        "text": "先基类，后派生类"
      },
      {
        "id": "C",
        "label": "C",
        "text": "只执行基类"
      },
      {
        "id": "D",
        "label": "D",
        "text": "顺序随机"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "析构顺序与构造相反，先销毁最派生部分，再逐层销毁基类部分。",
    "difficulty": 1,
    "tags": [
      "析构顺序",
      "继承"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp089",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "judge",
    "stem": "多重继承可能带来同名成员访问歧义，需要使用作用域限定或重新设计继承关系解决。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "多个基类提供相同名称时，未限定访问可能产生歧义，编译器无法自动判断目标成员。",
    "difficulty": 2,
    "tags": [
      "多重继承",
      "歧义"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp090",
    "chapterId": "inheritance-polymorphism",
    "chapterName": "继承与多态",
    "chapterOrder": 8,
    "type": "single",
    "stem": "protected 成员通常可以被谁直接访问？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "类自身及符合访问规则的派生类成员"
      },
      {
        "id": "B",
        "label": "B",
        "text": "任何外部函数"
      },
      {
        "id": "C",
        "label": "C",
        "text": "所有命名空间"
      },
      {
        "id": "D",
        "label": "D",
        "text": "只能被 main 函数"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "protected 对普通外部代码不可直接访问，但类自身、友元以及符合规则的派生类成员可以访问。",
    "difficulty": 1,
    "tags": [
      "protected",
      "访问控制"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp091",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "multiple",
    "stem": "关于运算符重载，下列哪些说法正确？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "不能改变运算符原有优先级"
      },
      {
        "id": "B",
        "label": "B",
        "text": "不能改变运算符原有结合性"
      },
      {
        "id": "C",
        "label": "C",
        "text": "不能创造新的运算符符号"
      },
      {
        "id": "D",
        "label": "D",
        "text": "可以让一元运算符变成四元运算符"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "重载只能为既有运算符定义适用于用户类型的行为，不能改变语法层面的优先级、结合性和操作数个数。",
    "difficulty": 2,
    "tags": [
      "运算符重载",
      "语法"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp092",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "multiple",
    "stem": "下列哪些 C++ 运算符不能被重载？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "."
      },
      {
        "id": "B",
        "label": "B",
        "text": "?:"
      },
      {
        "id": "C",
        "label": "C",
        "text": "::"
      },
      {
        "id": "D",
        "label": "D",
        "text": "+"
      }
    ],
    "correctOptionIds": [
      "A",
      "B",
      "C"
    ],
    "explanation": "成员访问点号、条件运算符和作用域解析运算符不能重载；加号可以为用户定义类型重载。",
    "difficulty": 2,
    "tags": [
      "运算符重载",
      "限制"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp093",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "声明一个类型模板参数的常见语法是哪一个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "template <typename T>"
      },
      {
        "id": "B",
        "label": "B",
        "text": "generic (T)"
      },
      {
        "id": "C",
        "label": "C",
        "text": "template = T"
      },
      {
        "id": "D",
        "label": "D",
        "text": "type <T>"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "template <typename T> 或 template <class T> 都可声明类型模板参数 T。",
    "difficulty": 1,
    "tags": [
      "模板",
      "typename"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp094",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "已定义类模板 Box<T> 后，创建 int 版本对象的典型写法是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "Box<int> value;"
      },
      {
        "id": "B",
        "label": "B",
        "text": "Box value<int>;"
      },
      {
        "id": "C",
        "label": "C",
        "text": "template Box int;"
      },
      {
        "id": "D",
        "label": "D",
        "text": "Box::int value;"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "在模板名后的尖括号中提供模板实参，Box<int> 表示以 int 实例化得到的类类型。",
    "difficulty": 1,
    "tags": [
      "类模板",
      "实例化"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp095",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "C++ 中用于抛出异常的关键字是哪一个？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "raise"
      },
      {
        "id": "B",
        "label": "B",
        "text": "throw"
      },
      {
        "id": "C",
        "label": "C",
        "text": "throws"
      },
      {
        "id": "D",
        "label": "D",
        "text": "panic"
      }
    ],
    "correctOptionIds": [
      "B"
    ],
    "explanation": "throw 表达式抛出异常；try 块包围可能抛出异常的代码，catch 处理匹配的异常。",
    "difficulty": 1,
    "tags": [
      "异常",
      "throw"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp096",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "捕获具有继承关系的异常对象时，catch 子句通常应如何排列？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "派生异常在前，基类异常在后"
      },
      {
        "id": "B",
        "label": "B",
        "text": "基类异常在前，派生异常在后"
      },
      {
        "id": "C",
        "label": "C",
        "text": "只能写一个 catch"
      },
      {
        "id": "D",
        "label": "D",
        "text": "顺序完全不影响匹配"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "异常处理按 catch 出现顺序匹配；若基类在前，它可能先捕获派生异常，使后面的派生类型处理不可达。",
    "difficulty": 2,
    "tags": [
      "catch",
      "继承"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp097",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "RAII 的核心思想是什么？",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "把资源生命周期绑定到对象生命周期"
      },
      {
        "id": "B",
        "label": "B",
        "text": "所有资源都使用全局变量"
      },
      {
        "id": "C",
        "label": "C",
        "text": "发生异常时跳过析构"
      },
      {
        "id": "D",
        "label": "D",
        "text": "只在程序结束时释放资源"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "RAII 在对象构造时取得资源，在析构时释放资源，使正常返回和异常退出都能遵循作用域清理。",
    "difficulty": 2,
    "tags": [
      "RAII",
      "资源管理"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp098",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "judge",
    "stem": "声明为 noexcept 的函数若让异常逃逸，程序会调用 std::terminate，而不是继续向外寻找普通 catch。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "noexcept 是不让异常逃逸的承诺，违反该承诺会触发 std::terminate。",
    "difficulty": 3,
    "tags": [
      "noexcept",
      "异常"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp099",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "single",
    "stem": "调用 identity(42) 时，模板参数 T 通常被推导为什么类型？",
    "code": "template <typename T>\nT identity(T value) {\n    return value;\n}",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "int"
      },
      {
        "id": "B",
        "label": "B",
        "text": "double"
      },
      {
        "id": "C",
        "label": "C",
        "text": "void"
      },
      {
        "id": "D",
        "label": "D",
        "text": "char*"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "整数字面量 42 默认具有 int 类型，按值形参由该实参推导出 T 为 int。",
    "difficulty": 1,
    "tags": [
      "函数模板",
      "类型推导"
    ],
    "status": "active",
    "version": 1
  },
  {
    "id": "cpp100",
    "chapterId": "operators-templates-exceptions",
    "chapterName": "运算符重载、模板与异常",
    "chapterOrder": 9,
    "type": "judge",
    "stem": "异常沿调用栈传播时，已经构造完成的自动对象会按作用域退出规则析构，这称为栈展开。",
    "options": [
      {
        "id": "A",
        "label": "A",
        "text": "正确"
      },
      {
        "id": "B",
        "label": "B",
        "text": "错误"
      }
    ],
    "correctOptionIds": [
      "A"
    ],
    "explanation": "栈展开会销毁离开作用域的已构造自动对象，这也是 RAII 能在异常路径释放资源的基础。",
    "difficulty": 2,
    "tags": [
      "栈展开",
      "析构"
    ],
    "status": "active",
    "version": 1
  }
];
