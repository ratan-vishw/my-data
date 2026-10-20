let userName = "BroCode";

console.log(userName.charAt(0));

let userName1 = "BroCode";
console.log(userName1.indexOf("o"));
console.log(userName1.lastIndexOf("o"));

let userName2 = "BroCode";
console.log(userName2.length);

let userName3 = "  BroCode";
console.log(userName3);
console.log(userName3.trim());

let userName4 = "BroCode";
console.log(userName4.toUpperCase());
console.log(userName4.toLowerCase());

let userName5 = "BroCode";
console.log(userName5.repeat(4));

let userName6 = "BroCode";
console.log(userName6.startsWith("B"));
console.log(userName6.endsWith("e"));

let userName7 = "Bro Code";
console.log(userName7.includes(" "));

let phoneNumber = "748-743-832";
phoneNumber = phoneNumber.replaceAll("-", "")
console.log(phoneNumber);

let phoneNumber1 = "748-743-832";
phoneNumber1 = phoneNumber1.padStart(20, "0");
console.log(phoneNumber1)