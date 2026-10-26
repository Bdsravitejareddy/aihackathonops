# Demo applicants and territories. Row values follow the template's Field guide.
TEMPLATE_STORES = None  # existing stores stay as in the template

DEMO1_TERRITORIES = [
  # id, city, state, pins, tier, slots, priority
  ('TER-01','Bengaluru','Karnataka','560101, 560102, 560103','Tier 1',2,'High'),
  ('TER-02','Bengaluru','Karnataka','560045, 560046','Tier 1',1,'Medium'),
  ('TER-03','Mysuru','Karnataka','570001, 570002, 570008','Tier 2',2,'High'),
  ('TER-04','Belagavi','Karnataka','590002, 590005','Tier 2',1,'Medium'),
  ('TER-05','Mangaluru','Karnataka','575002, 575003','Tier 2',1,'High'),
  ('TER-06','Hubballi-Dharwad','Karnataka','580001, 580002','Tier 2',1,'Medium'),
  ('TER-07','Tumakuru','Karnataka','572101, 572102, 572103','Tier 3',2,'Low'),
  ('TER-08','Davanagere','Karnataka','577001, 577002','Tier 3',1,'Low'),
]

# id, name, city, state, pin, investment, experience, business, space, area, floor, launch, language, notes
A = lambda *r: r
DEMO1_APPS = [
  A('APP-001','Ananya Rao','Bengaluru','Karnataka',560101,45,8,'Runs a garment boutique in Jayanagar','Owned',650,'Ground',4,'Kannada','Wants to open before the festive season'),
  A('APP-002','Karthik Shetty','Bengaluru','Karnataka',560102,40,6,'Owns two grocery stores','Rented',520,'Ground',4,'English',''),
  A('APP-003','Meera Nair','Bengaluru','Karnataka',560103,42,5,'Store manager at a footwear chain for five years','Rented',480,'First',5,'English',''),
  A('APP-004','Suresh Gowda','Bengaluru','Karnataka',560045,30,0,'No previous business','Rented',420,'Ground',6,'Kannada',''),
  A('APP-005','Lakshmi Iyer','Bengaluru','Karnataka',560046,31,1,'Runs a tailoring unit at home','Rented',410,'Ground',5,'English',''),
  A('APP-006','Rahul Menon','Bengaluru','Karnataka',560101,30,2,'Works in sales for a textile firm','Owned',440,'First',3,'English',''),
  A('APP-007','Priya Kulkarni','Mysuru','Karnataka',570001,36,4,'Runs a mobile accessories shop','Rented',460,'Ground',4,'Kannada',''),
  A('APP-008','Vinod Acharya','Mysuru','Karnataka',570002,34,0,'No previous business','Owned',600,'Ground',5,'Kannada','First franchise'),
  A('APP-009','Fathima Begum','Mysuru','Karnataka',570008,28,3,'Runs a home-based bakery','Rented',430,'Ground',6,'Hindi',''),
  A('APP-010','Ramesh Naik','Mysuru','Karnataka',570011,30,6,'Owns a readymade garments store','Rented',450,'First',4,'Kannada',''),
  A('APP-011','Deepa Hegde','Belagavi','Karnataka',590002,38,7,'Runs a saree showroom','Owned',700,'Ground',4,'Kannada',''),
  A('APP-012','Imran Sheikh','Belagavi','Karnataka',590005,22,2,'Runs a cloth shop','Rented',380,'Ground',4,'Hindi',''),
  A('APP-013','Sanjay Patil','Mangaluru','Karnataka',575002,44,9,'Owns a multi-brand fashion store','Owned',800,'Ground',3,'English',''),
  A('APP-014','Asha D\'Souza','Mangaluru','Karnataka',575003,33,4,'Store supervisor, five years','Rented',450,'Ground',5,'English',''),
  A('APP-015','Girish Hebbar','Hubballi-Dharwad','Karnataka',580001,37,5,'Runs a footwear shop','Rented',500,'First',4,'Kannada',''),
  A('APP-016','Naveen Desai','Hubballi-Dharwad','Karnataka',580002,30,1,'Works at a jewellery store','Not yet identified',None,None,6,'Kannada','Still looking for a shop on a main road'),
  A('APP-017','Gayathri Bhat','Tumakuru','Karnataka',572101,35,4,'Runs a beauty parlour','Owned',480,'Ground',5,'Kannada',''),
  A('APP-018','Manjunath Kumar','Tumakuru','Karnataka',572102,31,2,'No previous business','Rented',400,'Ground',6,'Kannada',''),
  A('APP-019','Shabana Khan','Davanagere','Karnataka',577001,29,3,'Runs a cloth shop','Rented',420,'Ground',4,'Hindi',''),
  A('APP-020','Ravi Teja N','Bengaluru','Karnataka',560150,36,5,'Owns a stationery store','Rented',430,'Ground',4,'English',''),
  A('APP-021','Chetan Rao','Mysuru','Karnataka',570009,40,6,'Runs a garment store','Owned',560,'Ground',4,'Kannada','Existing store location'),
  A('APP-022','Pooja Shetty','Bengaluru','Karnataka',560101,26,1,'Runs a boutique','Rented',410,'Upper',5,'English','Shop is on the second floor of a mall'),
  A('APP-023','Harish Pai','Mangaluru','Karnataka',575002,None,5,'Runs a shoe showroom','Rented',470,'Ground',4,'Kannada',''),
  A('APP-024','Shruti Joshi','Belagavi','Karnataka',590002,35,None,'Clothing business owner','Owned',520,'Ground',4,'Kannada',''),
  A('APP-025','Mohan Das','Tumakuru','Karnataka',572103,27,1,'No previous business','Rented',390,'First',6,'Kannada',''),
  A('APP-026','Anitha Reddy','Davanagere','Karnataka',577002,15,0,'No previous business','Rented',250,'Ground',9,'Kannada',''),
  A('APP-027','Yusuf Ali','Mysuru','Karnataka',570002,32,3,'Owns a cloth shop','Rented',440,'Ground',5,'Kannada',''),
  A('APP-028','Kavitha Murthy','Hubballi-Dharwad','Karnataka',580001,38,4,'Runs a boutique','Owned',470,'Other confirmed',4,'Kannada',''),
  A('APP-029','Sunil Kamath','Mangaluru','Karnataka',575003,22,0,'No previous business','Rented',410,'Ground',9,'English',''),
  A('APP-030','Divya Krishnan','Bengaluru','Karnataka',560103,41,7,'Owns a garment store in Indiranagar','Owned',620,'Ground',3,'English',''),
]

# Demo 2 (messy). Each row carries one or more deliberate problems; the comment says which.
DEMO2_TERRITORIES = [
  ('TER-01','Bengaluru','Karnataka','560101, 560102, 560103','Tier 1',0,'High'),        # zero open slots
  ('TER-02','Bengaluru','Karnataka','560045','Tier 1',None,'Medium'),                  # blank open slots
  ('TER-03','Mysuru','Karnataka','570001, 570002','Tier 2',2,'High'),
  ('TER-04','Mysuru','Karnataka','570002, 570008','Tier 1',1,'Medium'),               # pin 570002 overlaps TER-03; wrong tier
  ('TER-05','Mangaluru','Karnataka','57500, 575003','Tier 2',1,'Urgent'),             # 5-digit pin; invalid priority
  ('TER-06','Hubballi-Dharwad','Karnataka','580001','Tier 2',1,'Medium'),
  ('TER-07','Davanagere','Karnataka','577001, 577002','Tier 3',0,'Low'),              # zero open slots
  ('TER-01','Tumakuru','Karnataka','572101','Tier 3',1,'Low'),                         # duplicate territory ID
]
DEMO2_APPS = [
  A('APP-101','Ananya Rao','Bengaluru','Karnataka',560101,'2500000',8,'Runs a garment boutique','Owned',650,'Ground',4,'Kannada','Rupees, not lakh'),
  A('APP-102','Karthik Shetty','Bengaluru','Karnataka',560102,'₹25,00,000',6,'Owns two grocery stores','Rented',520,'Ground',4,'English',''),
  A('APP-103','Meera Nair','Bengaluru','Karnataka',560103,'25 lakhs',5,'Store manager at a footwear chain','Rented',480,'First',5,'English',''),
  A('APP-104','Suresh Gowda','Bengaluru','Karnataka',560045,'1.5 Cr',3,'No previous business','Rented',420,'Ground',6,'Kannada',''),
  A('APP-105','Lakshmi Iyer','Bengaluru','Karnataka','5600O1',31,1,'Runs a tailoring unit','Rented',410,'Ground',5,'English',''),   # letter O in pin
  A('APP-106','Rahul Menon','Bangalore','Karnataka',560101,30,2,'Works in sales','Owned',440,'First',3,'English',''),                # unknown city spelling
  A('APP-107','Priya Kulkarni','Mysore','Karnataka',570001,36,4,'Runs a mobile accessories shop','Rented',460,'Ground',4,'Kannada',''),  # city spelling
  A('APP-108','Vinod Acharya','Mysuru','Karnataka',570002,34,0,'No previous business','Owned',None,'Ground',5,'Kannada','Space size not confirmed'),  # blank area
  A('APP-109','','Mysuru','Karnataka',570002,30,3,'Runs a shop','Rented',440,'Ground',4,'Kannada',''),                         # blank name
  A('APP-110','Fathima Begum','Mysuru','Karnataka',570008,28,3,'Runs a home-based bakery','Rented','450 sq ft','Ground',6,'Hindi',''),  # area as text
  A('APP-111','Ramesh Naik','Mysuru','Karnataka',110001,30,6,'Owns a garments store','Rented',450,'First',4,'Kannada',''),     # Delhi pin in Mysuru
  A('APP-112','Deepa Hegde','Belagavi','Karnataka',590002,38,'7 years','Runs a saree showroom','Owned',700,'Ground',4,'Kannada',''),  # experience as text
  A('APP-113','Imran Sheikh','Belagavi','Karnataka',590005,22,2,'Runs a cloth shop','Rented',380,'Ground',4,'Tulu',''),           # language not offered
  A('APP-114','Sanjay Patil','Mangaluru','Karnataka',57500,44,9,'Owns a multi-brand fashion store','Owned',800,'Ground',3,'English',''),  # 5-digit pin
  A('APP-115','Asha D\'Souza','Mangaluru','Karnataka',575003,33,4,'Store supervisor','Rented',450,'Ground Floor',5,'English',''),  # floor not in list
  A('APP-116','Girish Hebbar','Hubli','Karnataka',580001,37,5,'Runs a footwear shop','Rented',500,'First',4,'Kannada',''),     # 'Hubli'
  A('APP-117','Naveen Desai','Hubballi-Dharwad','Karnataka',580001,30,1,'Works at a jewellery store','Not yet identified',600,'Ground',6,'Kannada','Still looking for a shop'),  # conflicting space data
  A('APP-118','Gayathri Bhat','Tumakuru','Karnataka',572101,35,4,'Runs a beauty parlour','Owned',480,'Ground',5,'Kannada','Owns the shop outright'),  # consistent
  A('APP-119','Manjunath Kumar','Tumakuru','Karnataka',572102,31,2,'No previous business','Rented',400,'Ground',6,'Kannada',''),
  A('APP-120','Shabana Khan','Davanagere','Karnataka',577001,29,3,'Runs a cloth shop','Rented',420,'Ground',4,'Hindi',''),          # zero-slot territory
  A('APP-121','Ravi Teja N','Bengaluru','Karnataka',560150,36,5,'Owns a stationery store','Rented',430,'Ground',4,'English',''),    # pin not covered
  A('APP-122','Chetan Rao','Mysuru','Karnataka',570009,40,6,'Runs a garment store','Owned',560,'Ground',4,'Kannada','Existing store location'),  # occupied pin
  A('APP-123','Pooja Shetty','Bengaluru','Karnataka',560101,26,4,'Runs a boutique','Rented',410,'Upper',5,'English',''),
  A('APP-124','Harish Pai','Mangaluru','Karnataka',575003,None,5,'Runs a shoe showroom','Rented',470,'Ground',4,'Kannada',''),  # blank investment
  A('APP-125','Shruti Joshi','Belagavi','Karnataka',590002,35,None,'Clothing business owner','Owned',520,'Ground',4,'Kannada',''),  # blank experience
  A('APP-126','Mohan Das','Tumakuru','Karnataka',572103,27,1,'No previous business','Rented',390,'First',6,'Kannada',''),
  A('APP-127','Anitha Reddy','Davanagere','Karnataka',577002,'twenty-four',2,'No previous business','Rented',400,'Ground',8,'Kannada',''),  # words, not numbers
  A('APP-128','Yusuf Ali','Mysuru','Karnataka',570002,32,3,'Owns a cloth shop','Rented',440,'Ground',5,'Kannada',''),  # duplicate pin with APP-108
  A('APP-101','Duplicate Entry','Bengaluru','Karnataka',560103,41,7,'Owns a store','Owned',600,'Ground',4,'English','Same ID as APP-101'),  # duplicate ID
  A('APP-129','Kavitha Murthy','Hubballi-Dharwad','Karnataka',580001,38,4,'Runs a boutique','Owned',470,'Other confirmed',4,'Kannada',''),
  A('APP-130','Sunil Kamath','Mangaluru','KA',575003,22,0,'No previous business','Rented',410,'Ground',9,'English','Karnataka state typed as KA'),
]
