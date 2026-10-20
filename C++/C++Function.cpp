#include<iostream>
using namespace std;
// p1 simple output by making func
void printHello() {
    cout<<"Hello !"<<endl;
  }

// p2.a 
int Sum(int a, int b){
  int s = a+b;
  return s;
}

//p2.b
float fSum(float a, float b){
  float s = a+b;
  return s;
}

//p2.c
double dSum(double a, double b){
  double s = a+b;
  return s;
}

//p3
int fact(int n){
  int sumoffact = 1;
  for (int i = 1; n>=i; i++){
    sumoffact *= i;
  }
  return sumoffact;
}

//p4
int fibonacci(int n) {
    if (n <= 1) {
        return n;
    }else {
      int a = 0, b = 1, c;
      for (int i = 2; i <= n; i++) {
        c = a + b;
        a = b;
        b = c;
      }
      return b;
    }
}

//output
int main(){
  cout<<"p1: ";
  printHello();

  cout<<"p2.a: ";
  cout<<Sum(3, 4)<<endl;

  cout<<"p2.b: ";
  cout<<fSum(4.7, 6.5)<<endl;

  cout<<"p2.c: ";
  cout<<dSum(5.76, 8.54)<<endl;

  cout<<"p3: ";
  cout<<fact(4)<<endl;

  cout<<"p4: ";
  cout<<fibonacci(5)<<endl;

  return 0;
}