export type WBDistrict = {
  district: string;
  blocks: {
    block: string;
    areas: string[];
  }[];
};

export const WB_DISTRICTS: WBDistrict[] = [
  {
    district: "Hooghly",
    blocks: [
      {
        block: "Arambagh",
        areas: [
          "Arandi I",
          "Arandi II",
          "Batanal",
          "Harinkhola I",
          "Harinkhola II",
          "Mayapur",
          "Salepur I",
          "Salepur II",
          "Tirtha",
        ],
      },
      {
        block: "Goghat I",
        areas: ["Bali", "Goghat", "Kayapat", "Raghubati"],
      },
      {
        block: "Goghat II",
        areas: [
          "Badanganj-Falui I",
          "Badanganj-Falui II",
          "Bengai",
          "Kamarpukur",
        ],
      },
      {
        block: "Khanakul I",
        areas: [
          "Arunda",
          "Balipur",
          "Ghoshpur",
          "Khanakul-I",
          "Khanakul-II",
          "Kishorpur-I",
          "Kishorpur-II",
          "Pole-I",
          "Pole-II",
          "Rammohan-I",
          "Rammohan-II",
          "Tantisal",
          "Thakuranichak",
        ],
      },
      {
        block: "Khanakul II",
        areas: [
          "Jagatpur",
          "Marokhana",
          "Natibpur-I",
          "Natibpur-II",
          "Rajhati-I",
          "Chingra",
          "Palaspai-I",
          "Palaspai-II",
        ],
      },
      {
        block: "Pandua",
        areas: ["Bantikabainchi", "Gurap", "Haral", "Pandua", "Simlagarh"],
      },
      {
        block: "Polba-Dadpur",
        areas: ["Dadpur", "Makalpur", "Polba", "Sugandha"],
      },
      {
        block: "Pursurah",
        areas: ["Bhangamora", "Pursurah", "Srirampur"],
      },
      {
        block: "Tarakeswar",
        areas: ["Bhanjipur", "Champadanga", "Tarakeswar", "Talpur"],
      },
      {
        block: "Dhaniakhali",
        areas: ["Belmuri", "Dashghara", "Gurap", "Somaspur"],
      },
      {
        block: "Balagarh",
        areas: ["Balagarh", "Ektarpur", "Jirat"],
      },
    ],
  },
  {
    district: "Bankura",
    blocks: [
      {
        block: "Indpur",
        areas: ["Bagda", "Indpur", "Banshichandrapur", "Raghunathpur"],
      },
      {
        block: "Bishnupur",
        areas: ["Ajodhya", "Dwarika", "Radhanagar"],
      },
      {
        block: "Bankura I",
        areas: ["Andharthole", "Jagadalla", "Kankata", "Kenjakura"],
      },
      {
        block: "Bankura II",
        areas: ["Bikna", "Junbedia", "Sanbandha"],
      },
      {
        block: "Barjora",
        areas: ["Barjora", "Chhandar", "Ghutgoria"],
      },
      {
        block: "Chhatna",
        areas: ["Arrah", "Chhatna", "Jirabaid"],
      },
      {
        block: "Gangajalghati",
        areas: ["Gangajalghati", "Kapista", "Pirraboni"],
      },
      {
        block: "Indas",
        areas: ["Akui", "Indas", "Karisunda"],
      },
    ],
  },
  {
    district: "Purba Medinipur",
    blocks: [
      {
        block: "Tamluk",
        areas: ["Anantapur I", "Anantapur II", "Nilkunthia"],
      },
      {
        block: "Panskura I",
        areas: ["Gopimohanpur", "Panskura", "Raghunathbari"],
      },
      {
        block: "Panskura II",
        areas: ["Baichberia", "Keshapat", "Raghunathpur"],
      },
      {
        block: "Nandakumar",
        areas: ["Basudevpur", "Byabattarhat Paschim", "Kumarchak"],
      },
      {
        block: "Moyna",
        areas: ["Bakcha", "Gojina", "Moyna"],
      },
      {
        block: "Kolaghat",
        areas: ["Amalhanda", "Brindabanchak", "Khanyadihi"],
      },
      {
        block: "Haldia",
        areas: ["Baruttarhingli", "Debhog", "Sutahata"],
      },
      {
        block: "Contai I",
        areas: ["Majilapur", "Nayaput", "Raipur-Paschimchak"],
      },
      {
        block: "Contai II",
        areas: ["Amardanagar", "Brajalalchak", "Sarada"],
      },
    ],
  },
  {
    district: "Paschim Medinipur",
    blocks: [
      {
        block: "Midnapore",
        areas: ["Barkola", "Jadupur", "Panchkhuri"],
      },
      {
        block: "Kharagpur I",
        areas: ["Barkola", "Gokulpur", "Kalaikunda"],
      },
      {
        block: "Kharagpur II",
        areas: ["Lachhmapur", "Madpur", "Sankoa"],
      },
      {
        block: "Debra",
        areas: ["Balichak", "Debra", "Satyapur"],
      },
      {
        block: "Pingla",
        areas: ["Gobardhanpur", "Pingla", "Pindrui"],
      },
      {
        block: "Sabang",
        areas: ["Bishnupur", "Sabang", "Dashgram"],
      },
    ],
  },
  {
    district: "Howrah",
    blocks: [
      {
        block: "Amta I",
        areas: ["Amta", "Bhandargachha", "Sirajbati"],
      },
      {
        block: "Amta II",
        areas: ["Amta", "Jhikira", "Tajpur"],
      },
      {
        block: "Bagnan I",
        areas: ["Bagnan", "Haturia", "Khalore"],
      },
      {
        block: "Bagnan II",
        areas: ["Antila", "Bainan", "Chandrapur"],
      },
      {
        block: "Uluberia I",
        areas: ["Hatgacha", "Uluberia", "Chandipur"],
      },
      {
        block: "Uluberia II",
        areas: ["Baniban", "Joypur", "Khalisani"],
      },
    ],
  },
  {
    district: "South 24 Parganas",
    blocks: [
      {
        block: "Baruipur",
        areas: ["Belegachhi", "Hardaha", "South Garia"],
      },
      {
        block: "Bhangar I",
        areas: ["Bhangar", "Chandaneswar", "Pranganj"],
      },
      {
        block: "Bhangar II",
        areas: ["Bamunia", "Beonta", "Jagulgachhi"],
      },
      {
        block: "Canning I",
        areas: ["Canning", "Dighirpar", "Matla I"],
      },
      {
        block: "Canning II",
        areas: ["Atharobanki", "Deuli I", "Tambuldaha I"],
      },
      {
        block: "Jaynagar I",
        areas: ["Dhosa", "Rajapur", "Uttar Barasat"],
      },
      {
        block: "Jaynagar II",
        areas: ["Baishata", "Kulta", "Mayahowri"],
      },
      {
        block: "Mathurapur I",
        areas: ["Dakshin Barasat", "Mathurapur", "Nalua"],
      },
      {
        block: "Mathurapur II",
        areas: ["Gilarchat", "Kumrapara", "Nandakumarpur"],
      },
    ],
  },
  {
    district: "North 24 Parganas",
    blocks: [
      {
        block: "Barasat I",
        areas: ["Kadambagachi", "Kotra", "Duttapukur"],
      },
      {
        block: "Barasat II",
        areas: ["Chandigoriya", "Shasan", "Rajarhat"],
      },
      {
        block: "Deganga",
        areas: ["Amulia", "Berachampa", "Sohai"],
      },
      {
        block: "Habra I",
        areas: ["Habra", "Machhlandapur", "Kumra"],
      },
      {
        block: "Habra II",
        areas: ["Ashokenagar", "Bhurkunda", "Gourbanga"],
      },
      {
        block: "Bongaon",
        areas: ["Bongaon", "Kalupur", "Petrapole"],
      },
    ],
  },
  {
    district: "Nadia",
    blocks: [
      {
        block: "Krishnanagar I",
        areas: ["Bhatjangla", "Dogachi", "Joania"],
      },
      {
        block: "Krishnanagar II",
        areas: ["Dhubulia", "Noapara", "Sadhanpara"],
      },
      {
        block: "Ranaghat I",
        areas: ["Habibpur", "Payradanga", "Tarapur"],
      },
      {
        block: "Ranaghat II",
        areas: ["Bahirgachhi", "Majhergram", "Nokari"],
      },
      {
        block: "Chakdaha",
        areas: ["Chakdaha", "Dewli", "Hingara"],
      },
      {
        block: "Berhampore",
        areas: ["Beldanga I", "Beldanga II", "Naoda"],
      },
      {
        block: "Kandi",
        areas: ["Kandi", "Khoshbagh", "Gokarna"],
      },
      {
        block: "Domkal",
        areas: ["Bhagirathpur", "Domkal", "Madhurkul"],
      },
      {
        block: "Jalangi",
        areas: ["Choapara", "Jalangi", "Sadikhander"],
      },
      {
        block: "Raninagar I",
        areas: ["Herampur", "Islampurchak", "Raninagar"],
      },
      {
        block: "Raninagar II",
        areas: ["Katlamari I", "Katlamari II", "Rajapur"],
      },
    ],
  },
  {
    district: "Birbhum",
    blocks: [
      {
        block: "Bolpur-Sriniketan",
        areas: ["Ballavpur", "Kasba", "Ruppur"],
      },
      {
        block: "Suri I",
        areas: ["Alunda", "Karidhya", "Tilpara"],
      },
      {
        block: "Suri II",
        areas: ["Domdama", "Kotasur", "Purandarpur"],
      },
      {
        block: "Rampurhat I",
        areas: ["Dakbanglow", "Kasthogara", "Narayanpur"],
      },
      {
        block: "Rampurhat II",
        areas: ["Bishnupur", "Margram", "Satpalsa"],
      },
      {
        block: "Nalhati I",
        areas: ["Banior", "Nalhati", "Paikar"],
      },
    ],
  },
  {
    district: "Malda",
    blocks: [
      {
        block: "English Bazar",
        areas: ["Amriti", "Jadupur", "Narhatta"],
      },
      {
        block: "Old Malda",
        areas: ["Jatradanga", "Mangalbari", "Muchia"],
      },
      {
        block: "Kaliachak I",
        areas: ["Alinagar", "Kaliachak", "Silampur"],
      },
      {
        block: "Kaliachak II",
        areas: ["Bangitola", "Hamidpur", "Rathbari"],
      },
      {
        block: "Kaliachak III",
        areas: ["Charianantapur", "Krishnapur", "Sahapur"],
      },
      {
        block: "Gazole",
        areas: ["Alal", "Gazole", "Pandua"],
      },
    ],
  },
  {
    district: "Uttar Dinajpur",
    blocks: [
      {
        block: "Raiganj",
        areas: ["Bahin", "Birghai", "Rampur"],
      },
      {
        block: "Hemtabad",
        areas: ["Bangalbari", "Hemtabad", "Naoda"],
      },
      {
        block: "Kaliaganj",
        areas: ["Dhankoil", "Mustafanagar", "Radhikapur"],
      },
      {
        block: "Islampur",
        areas: ["Agdimti-Khanti", "Gunjaria", "Matikunda"],
      },
    ],
  },
  {
    district: "Dakshin Dinajpur",
    blocks: [
      {
        block: "Balurghat",
        areas: ["Amritakhanda", "Chingisapur", "Najirpur"],
      },
      {
        block: "Gangarampur",
        areas: ["Ashokegram", "Basuria", "Belbari"],
      },
      {
        block: "Kumarganj",
        areas: ["Batun", "Deor", "Safanagar"],
      },
      {
        block: "Tapan",
        areas: ["Dwipkhanda", "Hazratpur", "Ramchandrapur"],
      },
    ],
  },
  {
    district: "Cooch Behar",
    blocks: [
      {
        block: "Cooch Behar I",
        areas: ["Chandamari", "Guriahati", "Pundibari"],
      },
      {
        block: "Cooch Behar II",
        areas: ["Ambari", "Baneswar", "Khagrabari"],
      },
      {
        block: "Dinhata I",
        areas: ["Bhetaguri", "Dinhata", "Okrabari"],
      },
      {
        block: "Dinhata II",
        areas: ["Bamanhat", "Chowdhurihat", "Sahebganj"],
      },
      {
        block: "Mathabhanga I",
        areas: ["Gopalpur", "Hazrahat", "Pachagarh"],
      },
    ],
  },
  {
    district: "Jalpaiguri",
    blocks: [
      {
        block: "Jalpaiguri",
        areas: ["Arabinda", "Bahadur", "Kharia"],
      },
      {
        block: "Rajganj",
        areas: ["Binnaguri", "Fulbari", "Sukhani"],
      },
      {
        block: "Maynaguri",
        areas: ["Domohani", "Madhabdanga", "Sapti Bari"],
      },
    ],
  },
  {
    district: "Alipurduar",
    blocks: [
      {
        block: "Alipurduar I",
        areas: ["Chakowakheti", "Paschim Jitpur", "Salkumar"],
      },
      {
        block: "Alipurduar II",
        areas: ["Chaparerpar I", "Chaparerpar II", "Majherdabri"],
      },
      {
        block: "Falakata",
        areas: ["Dalgaon", "Falakata", "Jateswar"],
      },
    ],
  },
  {
    district: "Darjeeling",
    blocks: [
      {
        block: "Darjeeling Pulbazar",
        areas: ["Badamtam", "Lebong", "Rangli"],
      },
      {
        block: "Kurseong",
        areas: ["Chimney", "Seokbir", "Sittong"],
      },
      {
        block: "Matigara",
        areas: ["Atharakhai", "Champasari", "Matigara"],
      },
    ],
  },
  {
    district: "Kalimpong",
    blocks: [
      {
        block: "Kalimpong I",
        areas: ["Algara", "Gitdabling", "Kalimpong"],
      },
      {
        block: "Kalimpong II",
        areas: ["Gorubathan", "Lava", "Pedong"],
      },
    ],
  },
  {
    district: "Purulia",
    blocks: [
      {
        block: "Purulia I",
        areas: ["Arsha", "Garh Joypur", "Lagda"],
      },
      {
        block: "Purulia II",
        areas: ["Belma", "Bongabari", "Hutmura"],
      },
      {
        block: "Raghunathpur I",
        areas: ["Arrah", "Neturia", "Sanka"],
      },
      {
        block: "Raghunathpur II",
        areas: ["Cheliyama", "Joradih", "Nildih"],
      },
    ],
  },
];

